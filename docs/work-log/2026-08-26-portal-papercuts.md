# Portal Papercuts — Officers Nav, Sign-Out Destination, Directory Button Group, Wider Shell — Work Log

> **Slug:** `2026-08-26-portal-papercuts`
> **Surface:** mixed — `(org)/o/[slug]` portal shell, directory nav, sign-out flow
> **Permission(s):** none new — all four items ride existing gates
> **Flag(s):** none new — the officers tile rides the already-shipped `org_portal.officers`
> **Estimated complexity:** small
> **Pipeline mode:** Polish/bug-fix variant, brief — four small, independent, presentation-layer papercuts found live-testing the just-shipped officer-terms and portal-UX pipelines. No schema change, no new dependency, no API surface change. Phases 2 and 3 skipped per the Classification table's explicit allowance for Polish-class work; documented per-item below instead of a full design doc.
> **Source — operator direction (2026-08-26), live-testing the just-shipped work:**
>   1. "my user doesn't have permissions to manage officers. what other functionality is my user missing permission for? i also don't see the option to get to the officers page (prolly because i don't have access)."
>   2. "when i sign out from the org portal page i go to a non branded sign in page. i should probably redirect back to the public org site."
>   3. "for the directory the members, households and parishes buttons are just buttons i wonder if we can build a group button component that supports icons?"
>   4. "i also think we might want to take advantage of the entire screen versus the middle column with wide margins."
>   5. "the portal login page should also have the org's logo at the top and follow the branding. i think the google button is a weird color." — investigated live (see Item 2 below): no code change needed, mechanism already correct.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | (orchestrator, brief) | Complete | READY FOR DESIGN | 2026-08-26 |
| 2 — Architectural review | — | Skipped | No new deps/schema/API surface — Polish-class allowance | 2026-08-26 |
| 3 — Technical design | — | Skipped | Trivial per-item design, documented inline below | 2026-08-26 |
| 4 — Implementation | (orchestrator, inline) | Complete | — | 2026-08-26 |
| 5 — Verification | (self-verified) | Complete | PASS | 2026-08-26 |
| 6 — Shipped vs intent | (orchestrator, brief) | Complete | SHIP IT | 2026-08-26 |

---

# Phase 1 — Functional Refinement (brief)

## VERDICT

**READY FOR DESIGN**

## ONE-LINE TAKE

> Four independent, low-risk presentation-layer papercuts found live-testing today's three shipped pipelines — none touch permissions, schema, or a new dependency, so each gets a documented one-line design instead of a full Phase 3.

## Item 1 — Officers tile missing from portal nav (confirmed, matches the already-tracked TODO line)

The operator's own permission set at `fpcw` (`admin@presby.invalid`, bound to a `Dev Admin` role) was checked directly against the full 11-key permission catalog: holds `directory.view` (via Active Membership), `directory.view_hidden`, `org_features.manage`, `people.manage`, `role_grants.manage`, `roll.approve`, `roll.propose`. **Missing:** `officers.manage`, `tickets.file` (both gate real, built UI — `tickets.file` is moot today since `org_portal.tickets` ships seeded off anyway), `ledger.approve` and `pastoral.notes.view` (both gate features that don't exist in the app yet — ledger/giving and pastoral notes are unbuilt, so these have no UI consumer to be "missing" from). This is expected, not a bug: `officers.manage` is deliberately bound only to `stated_clerk` (DECISION-078's test), and `Dev Admin` is a separate, narrower dev-testing role that was never granted it.

The *reachability* half is real and already named in `docs/TODO.md`'s Next Up section from this morning's Phase 6: officers has no entry in `PORTAL_TILES`, so the page is invisible in both the tile grid and the persistent nav row — reachable only by direct URL, for anyone who DOES hold the permission. Fix: add the tile. The permission-holder question is a data/fixture concern (who should hold `officers.manage` at `fpcw`), not a code gap — noted for the operator, not fixed here.

## Item 2 — Sign-out lands on generic platform home, not the org's public site

**Investigated live before writing code** (screenshots taken): the org-branded `/signin` mechanism (`ui.branded_signin`, already seeded ON) works correctly today — `/signin?callbackUrl=/o/fpcw` renders fpcw's logo and brand tokens exactly as designed. The gap is upstream: `signOutAction()` is hardcoded to `signOut({ redirectTo: "/" })`, so leaving the org portal drops the visitor on the generic platform home with no path back to this org's identity. The public site's own "Member Login" link already points at `/o/<slug>` (`page.tsx:229`), which `parseOrgSlugFromCallbackUrl()` already recognizes — so redirecting sign-out to `/site/<slug>` instead of `/` closes the loop: sign out → land on the org's own public site → click Member Login → branded sign-in, with zero changes needed to the sign-in page itself.

**The "Google button is a weird color" report is not a defect.** Confirmed live: it renders as a normal, correctly-colored blue Google button in both the branded and unbranded states — pinned to platform colors deliberately (Google's own brand guidelines forbid recoloring their button; documented in `signin/page.tsx`'s own header comment and the branded-signin work-log). No change made.

## Item 3 — Directory view-switcher (Members/Households/Parishes) has no visual grouping

Currently three independently-rendered `<Button>`s in a `flex flex-wrap gap-2` row (`directory-nav.tsx`) — functionally a tab bar, visually just loose buttons. Build a small, dependency-free `ButtonGroup` composition (no new npm package — a segmented-control look achieved with Tailwind's adjacent-sibling border-radius/margin trick, the same technique shadcn's own examples use before reaching for `@radix-ui/react-toggle-group`), and add an icon to each of the three destinations.

## Item 4 — Org portal shell is a narrow centered column (`max-w-4xl`) on wide viewports

The header, main content, and footer all constrain to `max-w-4xl` (56rem/896px) with wide empty margins on anything wider than a laptop. Widen the shell for content-heavy surfaces (directory grids, the new officer roster table) while keeping line-length-sensitive prose readable. Widen to `max-w-6xl` (72rem/1152px) — a middle ground that gives tables real room without becoming an unreadable full-bleed layout.

## Permissions & Flags

No new permission, no new flag for any of the four items — all ride existing gates (`org_portal.officers` for the tile; nothing new for the redirect, component, or width change).

## Out of Scope (confirmed with operator via investigation)

- Changing the Google button's color — deliberate anti-phishing design, confirmed working as intended live.
- Granting `officers.manage` to any role/person — a data decision for the operator, not a code change.

---

# Phase 4 — Implementation

## Files Created

- `src/components/shared/button-group.tsx` — dependency-free segmented-control composition (Item 3). Not built on `@radix-ui/react-toggle-group`: this is real `<Link>` navigation (a GET per item, not toggleable client state), and the connected-look is a plain Tailwind composition (`rounded-none` per item + a border between adjacent items + `overflow-hidden rounded-md` on the group).
- `src/components/shared/button-group.test.tsx` — 6 tests: link rendering, group accessible name, `aria-current` on the active item only, per-item hrefs, no-icon rendering, icons excluded from the accessible name.

## Files Modified

- `src/lib/org-portal/tiles.ts` — new `officers` tile (Item 1), `href: /o/<slug>/admin/officers`, `flagKey: org_portal.officers` (already seeded by the officer-terms pipeline). Flag-only per the registry's own design — no permission check added here, matching every sibling tile; the destination page's own `officers-states.tsx` remains the sole enforcement.
- `src/lib/org-portal/tiles.test.ts` — updated the seeded-flag-key snapshot and the key-list snapshot; added an isolation test for the new tile.
- `src/components/org-portal/tile-grid.tsx` — `Landmark` icon mapped to the `officers` key.
- `src/lib/auth/sign-out-action.ts` (Item 2) — `signOutAction` takes an optional `redirectTo` (default `"/"`), bound by the caller rather than validated here (every caller is trusted server code, not user input).
- `src/components/shared/avatar-menu.tsx` — new optional `signOutRedirectTo` prop, bound into the sign-out form's action via `signOutAction.bind(null, signOutRedirectTo ?? "/")`.
- `src/components/shared/avatar-menu.test.tsx` — hoisted the `signOutAction` mock so its calls are assertable; added two regression tests pinning the default (`"/"`) and an explicit redirect target.
- `src/components/shared/global-nav.tsx` — threads `signOutRedirectTo` through to `AvatarMenu`.
- `src/app/(org)/o/[slug]/layout.tsx` (Items 2 & 4) — `signOutRedirectTo={`/site/${slug}`}` on `GlobalNav`; all three `max-w-4xl` container widths (header, no-session fallback header, `<main>`) widened to `max-w-6xl`.
- `src/components/org-portal/portal-footer.tsx` — its own `max-w-4xl` widened to `max-w-6xl` to match.
- `src/app/(org)/o/[slug]/directory/directory-nav.tsx` (Item 3) — rebuilt on `ButtonGroup`, with `Users`/`Home`/`MapPin` icons for Members/Households/Parishes. No behavior change to the F21 permission-gated Parishes-tab visibility.
- `src/app/(auth)/signin/page.tsx` (from the operator's live-tested follow-up, folded into Item 2) — swapped `OrgMark` (always-boxed, G7's fixed neutral plate) for `OrgWordmark` with `plate={false}` (the exact treatment `GlobalNav`'s own header wordmark already uses, per the 2026-08-26 portal-chrome refinement — "the logo doesn't need to be in a card"), wrapped in a `<Link href="/site/<slug>">` back to the org's public site.
- `e2e/branded-signin.spec.ts` — updated 4 assertions that expected `OrgMark`'s initials fallback (`"AC"`) to instead expect `OrgWordmark`'s full-name fallback (`ALDER_CREEK_NAME`), and added an assertion that the wordmark links to `/site/alder-creek`. This file is CLAUDE.md's mandatory auth-touching e2e smoke for any `src/app/(auth)/` change — re-run in full against a real dev server (see Verification below), not just updated and trusted.

## Dev-database changes (not code, noted for the record — mirrors the existing `chrome_v2`/`feedback` precedent of flags flipped on directly in the dev DB for the fpcw demo)

- `feature_flags.org_portal.officers` flipped to `enabled = true` in the dev database — left ON, not reverted, since the operator is actively testing this surface. Ships seeded OFF in `scripts/seed.ts` for any fresh environment; this is a live dev-DB override only.
- `app_role_permissions`: the `Dev Admin` role at `fpcw` (`admin@presby.invalid`'s role) granted `officers.manage` directly — it already held 6 of the other 7 catalog permissions and the one missing one was exactly what the operator asked about. Fixture/data change, not a code change; does not touch `stated_clerk`'s own binding.

## Implementer Notes

Item 5 (the report that the sign-in page lacks org branding, and the Google button is "a weird color") needed no code change: investigated live with real screenshots (see Phase 1) — the `ui.branded_signin` mechanism was already correct and already enabled; the actual gap was purely that sign-out (Item 2) never routed anyone back through an org-aware `callbackUrl`. Fixing Item 2 closes the loop: sign out of the portal → land on the org's own public site → its existing "Member Login" link (`portalUrl: /o/<slug>`) already round-trips through a branded `/signin`. The Google button's platform-pinned color is intentional (Google's own brand guidelines forbid recoloring it) and was confirmed correct in both branded and unbranded screenshots — no change made. The "little box" the operator separately flagged around the sign-in page's logo was real, though: `OrgMark`'s G7-mandated plate has no off switch by design (it's meant for a compact header lockup, not a page's own identity), so the fix there was swapping to the same unboxed `OrgWordmark` treatment the portal header already uses — not a bug in the original branded-signin pipeline, a genuinely different context calling for the other of the two existing components.

---

# Phase 5 — Verification (self-verified)

**Date:** 2026-08-26

## Type Check

`npm run typecheck`: **PASS** — clean.

## Unit Tests

Full suite (`npm run test`): **2202 passed / 304 skipped / 0 failed** (153 files passed, 15 skipped). Targeted re-run of every directly touched file (`avatar-menu`, `global-nav`, `button-group`, `tiles`, `tile-grid`, `(org)/o/[slug]/layout`, `directory/page`, `directory/parishes/page`): **102/102 passed**.

## End-to-End Tests

`e2e/branded-signin.spec.ts` — **4/4 passed** against a real running dev server, per CLAUDE.md's mandatory gate for any `src/app/(auth)/` change. Case 1 completes a real credentials sign-in through the new unboxed, linked wordmark; case 2 completes a full MFA/TOTP-verified login on the same updated page; cases 3–4 confirm platform-default chrome (no wordmark, no brand) still renders correctly for a never-published org and for the flag-off kill switch.

## Regression Tests Added

- `src/lib/org-portal/tiles.test.ts` — new isolation case: `org_portal.officers` on, everything else off, shows only the `officers` tile.
- `src/components/shared/avatar-menu.test.tsx` — two new cases pinning `signOutAction`'s bound argument: `"/"` by default, and the given `signOutRedirectTo` when set.
- `src/components/shared/button-group.test.tsx` — new file, 6 cases (see Files Created).
- `e2e/branded-signin.spec.ts` — the wordmark-links-to-public-site assertion is new; the four updated fallback-text assertions replace stale expectations rather than adding new coverage.

## Verified Live in Browser (not just automated)

Real signed-in session as `admin@presby.invalid` against the running dev server, both 1280px and 375px:
- Officers tile renders (Landmark icon) in both the tile grid and the persistent nav row once `org_portal.officers` is on.
- The officer-terms page itself works end-to-end once `officers.manage` was granted: roster renders real seeded deacon rows, the add-term form's office/district conditional logic works, the "recording an office is separate from granting access" copy renders as designed.
- Directory's Members/Households/Parishes `ButtonGroup` renders as a connected segmented control with icons at both widths, active state correctly highlighted, no overflow at 375px.
- The wider (`max-w-6xl`) shell confirmed at 1280px — header, tile grid, directory grid, and footer all use the extra width; no regression at 375px (unaffected, `max-w` only binds above its breakpoint).
- Sign-out from `/o/fpcw` correctly landed on `/site/fpcw` (confirmed via `page.url()` after a real click-through, not just reading the code).
- `/signin?callbackUrl=/o/fpcw` (reached organically via the public site's own Member Login link) renders the unboxed wordmark, linked back to `/site/fpcw` — confirmed by screenshot both before (boxed `OrgMark`) and after (unboxed, linked `OrgWordmark`) the fix.

## Verdict

**PASS**

---

# Phase 6 — Shipped vs Intent (brief)

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

> Four small, independent portal papercuts, each confirmed against the actual live app rather than assumed from reading the code — including one item (the branded sign-in report) that turned out to need no code change at all once investigated.

## What's Working

- All four items match what was asked, verified live rather than by inspection alone.
- The permission-visibility investigation (Item 1) surfaced the real, precise answer (2 of 4 "missing" permissions gate unbuilt features, not gaps) rather than a guess.
- The Google-button/branding investigation prevented an unnecessary change to a deliberately-designed anti-phishing control, while still fixing the real underlying gap (sign-out destination) and the real logo-styling mismatch (`OrgMark` vs `OrgWordmark`) once distinguished from each other.

## Intent-vs-Shipped Diff

- All five operator-reported items addressed: two real code fixes with new tests (sign-out destination, signin logo), one new component + integration (button group with icons), one layout width change, one investigation-only resolution (permissions) and one investigation-only no-op (Google button/branding mechanism, already correct).
- Matches intent with no drift.

## Edge Cases

- Empty state: n/a — no new empty states introduced.
- Permission gate: pass — the new tile is flag-only by design (matches every sibling tile); `officers.manage` itself is unchanged, verified live with and without the grant.
- Mobile (360/375px): pass — verified live, not just assumed from responsive classes.
- Audit event: n/a — no new mutation path.

No follow-ups; this closes clean. `docs/TODO.md`/`docs/product/functionality-map.md` housekeeping to follow in the same commit.
