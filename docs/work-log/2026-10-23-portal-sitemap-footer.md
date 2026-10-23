# Portal menu and site-map footer from one structure — Work Log

> **Slug:** `2026-10-23-portal-sitemap-footer`
> **Surface:** (org) — the portal nav (`portal-nav.tsx`) and footer (`src/components/org-portal/portal-footer.tsx`)
> **Permission(s):** existing; tiles keep their own gates
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Full (small; Phase 2 may be skipped with notation if no structural change)
> **Source:** operator, 2026-10-23: "the portal footer doesn't match the menu. on the menu i think we should have Community instead of people and membership as the menu title. i like the site map footers most website have with menu and submenu laid out in columns. maybe we can do something like that. also wondering if where the setup of features is per organization? feels like the menu should be driven off some data structure. right now it probably isn't simply because i see different titles."
> **What exists (orchestrator):** `src/lib/org-portal/tiles.ts` is the data structure. Each tile has a label, href, permission gate, `category` (operate | administer) and `domain`. `DOMAIN_LABELS` names the domains ("People & Membership", …), and `visiblePortalTiles()` filters tiles by the org's per-organization feature toggles and by the viewer's permissions. The nav shows domain labels computed from operate tiles. The footer shows operate tiles flat, by tile label, so the two read the same structure differently. Administer tiles never reach the footer. Features are per organization (`org_features` toggles on the portal's Features page).
> **Requested change:** rename the `people` domain label to "Community"; make the footer a site map with one column per domain, the visible tiles listed under each, and an Administration column for viewers with administer tiles; nav and footer both derive from the same structure.
> **Pre-assigned numbers (Rule 16):** DECISION-220–222 · F220–F224 · no migration expected · worktree `presby-nav` · Neon branch: none needed unless Phase 3 says so (shares `pipeline-person-emails` read-only for tests)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-23 |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

*Recorded verbatim by the orchestrator.*

Pipeline: `2026-10-23-portal-sitemap-footer`. Reviewed read-only against the `presby-nav` worktree.

## VERDICT

**READY WITH NOTES.** Notes 1–6 are binding inputs to Phase 2/3. Two operator questions each carry a default, and the pipeline can proceed on those defaults.

## ONE-LINE TAKE

> Rename one label and build a single menu structure that both the nav and the site-map footer render. Three things in the request aren't what they look like: "Community" already labels an operate tile, "tiles the viewer can see" means flags and toggles rather than permissions, and a footer heading would break an existing e2e locator.

## Corrections to the orchestrator's summary

These change the design, so they come first.

1. **The "Community" tile is not an admin tile.** `PORTAL_TILES` key `members` has `label: "Community"`, `category: "operate"` and `domain: "people"` (`src/lib/org-portal/tiles.ts:223-232`). Only its href lives under `/admin/community`. It is a card inside the People section on the home page, and it already appears in the nav's domain bucket and the footer's flat list.
2. **"Visible to the viewer" is not permission-based.** `visiblePortalTiles()` (`src/lib/org-portal/visible-tiles.ts:87-109`) filters by category, `orgTypeScope`, platform flag, and per-org toggle. It applies no permission check. This is DECISION-003 and DECISION-162, stated at `tiles.ts:21-58` and in the header of `admin/page.tsx`. A plain member sees every operate tile whose flag is on, and every administer tile once `org_portal.admin_hub` is on. They click through to that destination's own Forbidden state. The "plain member sees only Directory and Calendar" case only holds when the other flags are off.
3. **Per-org setup reaches the tiles in only three places.** See "The operator's question" below.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Authenticated member (any `/o/<slug>/*` page, 2FA already enforced by the proxy) | Scans the footer site map and clicks a tile link to jump to a tool without scrolling back to the nav | On demand, every page |
| Authenticated member | Clicks a nav domain pill, which scrolls to that domain's section on `/o/<slug>` | On demand |
| Authenticated member | Taps the phone number in the footer (`tel:`) | Rare |
| Member holding admin permissions | Clicks an Administration-column link to reach Roles, Features, Branding, Manage events and so on | On demand |
| Member without admin permissions | Sees administration links and lands on that destination's Forbidden page (existing hub behaviour, now repeated on every page) | Accidental |
| Anonymous / no-roles user | None. The footer never renders for them. | n/a |

The request says "the viewer" throughout without naming a surface. It is all authenticated org members, in the brandable `(org)` group.

## Flows

**Flow 1: Footer as site map.** Entry: any `/o/<slug>/**` page with `org_portal.chrome_v3` on and `resolved.kind === "ok"`. Steps: footer lists Home, then one column per domain that has at least one visible operate tile (`DOMAIN_ORDER`), then the Administration column. The member clicks a link and navigates; the destination authorizes.
- Failure: a tile's gate read fails and that tile is hidden. `tileGateOpen` catches and logs ids only (`visible-tiles.ts:77-83`). A domain whose tiles all fail disappears. The footer never throws and never takes the page down. Worst case is Home, contact info and copyright.

**Flow 2: Nav domain pill.** Entry: the nav row. Click "Community" and go to `/o/<slug>#domain-people`, which lands on the home section. On any other page it navigates to home and then scrolls. This is unchanged except for the label.
- Failure: if no section exists for the anchor, the page loads at the top. This is acceptable and not new.

**Flow 3: Administration.** Entry: the nav entry or the footer column. The nav entry goes to `/o/<slug>/admin`. Footer tile links go straight to destinations.
- Failure: with `admin_hub` off, the hub renders `AdminHubFlagOff`. The decision on when each surface shows Administration is in Note 3.

**Flow 4: Brand-new org or sparse viewer.** Footer is Home plus a few small columns, plus contact info and copyright. See Gaps.

## Permissions & Flags

- **Permission(s):** none new. Tiles stay permission-blind, and destinations stay the sole authority.
- **Default roles:** n/a.
- **Flag(s):** no new flag. The existing `org_portal.chrome_v3` (footer) and `org_portal.chrome_v2` (nav) are the rollback units. Flipping `chrome_v3` off restores the no-footer state. Reverting the rename needs a code change; the label is the only thing being renamed (see Note 2). This matches the operator's standing rule against new global flags pre-go-live.
- **Administration gate:** `org_portal.admin_hub`, the same gate the nav uses today.

## Where every tile lands

Default rule (confirm in Q1): operate tiles go under their domain column, and all administer tiles go under one Administration column regardless of their own `domain`. This follows the request's "Administration column for viewers who have administer tiles" and matches the nav's standing rule that the `administration` domain never becomes an anchor pill.

| Tile (key, label) | Category | Domain column | Org types | Gate |
|---|---|---|---|---|
| members, "Community" | operate | Community | all | flag `members_create` |
| directory, "Directory" | operate | Community | all | flag |
| groups, "Groups" | operate | Community | all | flag |
| staff, "Staff" | operate | Community | all | flag |
| officers, "Officers" | operate | Governance & Courts | all | flag |
| credentials, "Credentials" | operate | Governance & Courts | presbytery | flag |
| committees, "Committees & Commissions" (comingSoon) | operate | Governance & Courts | presbytery | flag |
| oversight, "Congregation Oversight" | operate | Governance & Courts | presbytery | flag |
| calendar, "Calendar" | operate | Worship & Events | all | per-org toggle only |
| worship, "Worship & Service Planning" (comingSoon) | operate | Worship & Events | all | flag |
| giving, "Giving" | operate | Giving & Finance | congregation, NWC | per-org toggle only |
| insights, "Insights & Analytics" (comingSoon) | operate | Reports & Insights | all | flag |
| communications, "Communications" (comingSoon) | operate | Communications | all | flag |
| roles, "Roles" | administer | Administration | all | flag |
| tickets, "Tickets" | administer | Administration | all | flag |
| features, "Features" | administer | Administration | all | flag |
| branding, "Branding" | administer | Administration | all | flag |
| events, "Manage events" | administer | Administration (its domain is worship) | all | flag |
| giving-admin, "Manage giving" | administer | Administration (its domain is giving) | congregation, NWC | per-org toggle |
| domains, "Website domain" | administer | Administration (its domain is communications) | all | per-org toggle |
| reports, "Per-Capita, SASR & Imports" | administer | Administration (its domain is reports) | presbytery | flag |
| filings, "Statistical Filings" | administer | Administration (its domain is reports) | congregation | flag |

That is 22 tiles: 13 operate and 9 administer. There is no Reports & Insights column for a congregation unless Insights (comingSoon) is flagged on.

Consequences for the design:
- Administer tiles whose `domain` is not `administration` (events, giving-admin, domains, reports, filings) will not appear under Worship, Giving and so on. Only the Administration column carries them. This is the intended reading, and the alternative is in Q1.
- comingSoon tiles are flagged on in dev only (a go-live gate item in `docs/TODO.md`). The nav already makes a pill for a domain whose only visible tile is comingSoon, for example Communications. For titles to match, the footer must include them. Default: the structure includes them, and the footer renders a plain "Coming soon" text suffix. Never hide them in one surface and not the other.

## Gaps the Request Didn't Address

### Note 1: the "Community" collision

Check where each appears. The domain label (`DOMAIN_LABELS.people`) feeds five surfaces:
- the nav pill, which links to `#domain-people`;
- the home section `<h2>`;
- the admin hub section headings (none today, because no administer tile is in `people`);
- the Features page category label (`org-feature-categories.ts` imports `DOMAIN_LABELS`; `org-features.test.ts:470` pins "People & Membership");
- the new footer column heading.

The tile "Community" appears as a home card and a footer link, and in the nav's domain bucket. Its destination page has H1 "Community" (`admin/community/page.tsx:58,208`) and the heading is pinned by `page.test.tsx:193` and `e2e/community-participants.spec.ts:283`. It was deliberately renamed from "Members" in v0.39.0 (DECISION-197–201).

After the rename, one home view shows three things called Community: the nav pill (anchor on the same page), the section heading, and the card (to `/admin/community`). The pill and the card are two different "Community" links going different places, which is exactly the thing to avoid. The footer has the same stutter: column "Community" containing item "Community".

Recommendation, which is the default for Q2:
- Domain label becomes "Community".
- The tile stays "Community". Renaming it would reverse a rename shipped one release ago and cascade into the page H1, tests and e2e.
- In the footer, column headings are plain text, never links. That way there is one "Community" link in the footer, to the page, rather than a heading link to an anchor plus an item link.
- The pill-versus-card pair on the home page is the one accepted residual, flagged for the operator in Q2.
- This is not new precedent. Communications (domain) and Communications (comingSoon tile) already collide in dev. `tiles.ts:98-112` already excludes "administration" from the nav to avoid the identical-label, different-destination problem. The no-duplicate-label rule should be stated once, in the new structure's header.

Other points on the rename:
- **Change the label only.** The key `people` stays. It is the DB CHECK value for `organization_feature_categories.category`, the `#domain-people` anchor id and the icon map key. No migration.
- **The rename touches more than the nav, and more tests than the nav.** Surfaces that will read "Community": the Features page category header (an org admin who turns off the "Community" category is turning off the whole People domain), and the catalog entry named "Community: add people and record roll actions" (`org-features.ts:66`).
- **Pinned labels that need updating:**
  - `portal-nav.test.tsx` (37, 146, 197, 236, 275) mocks the labels as literals.
  - `portal-nav-links.test.tsx` (218–288)
  - `page.test.tsx` (74, 301)
  - `admin/page.test.tsx` (66, 296)
  - `domain-tile-sections.test.tsx` (27, 60)
  - features tests: `features-list.test.tsx:44`, `features/page.test.tsx:302,333`, `feature-categories-list.test.tsx:42,119`
  - `org-features.test.ts:470`

### Note 2: one structure, and what it must contain

Today the nav hard-codes two entries outside `PORTAL_TILES`: "Home" (`portal-nav.tsx:116`) and "Administration" (`portal-nav.tsx:123-132`, gated on `admin_hub`). The footer hard-codes its own "Home" (`portal-footer.tsx:125-132`). So three literals sit outside the data.

For "titles always match", the shared structure must include Home and Administration as first-class members, with labels from one place (`DOMAIN_LABELS.administration` already says "Administration"). The nav should render the structure's top-level entries, and the footer should render the same entries expanded to their tiles. Placement is the architect's decision. Constraints the architect must honor:
- **Import cycle.** `tiles.ts` is data and types only, and importing `org-features` there closes a cycle (F135, `tiles.ts:3-9`). The builder belongs next to `visible-tiles.ts` or as a pure function that takes tiles as input.
- **Mocked test environment.** `portal-nav.test.tsx` and `portal-footer.test.tsx` mock `tiles` and `visible-tiles` because `server-only` and the DB cannot load in jsdom. The builder should be a pure function that takes already-resolved tiles, so it is unit-testable without mocks.
- **Parity test.** Add a test that feeds one input to the builder and asserts that every nav label appears as a footer column heading (or Home or Administration), and that the nav's entry order equals the footer's column order.

### Note 3: Administration must follow one rule in both places

Today the nav shows Administration whenever `admin_hub` is on, even if zero administer tiles are visible (the hub then says "Nothing is turned on here yet."). The request says the footer shows the column "for viewers who have administer tiles". Those two rules diverge, and divergence is what the operator complained about.

Default: one rule for both. Administration appears iff `admin_hub` is on and at least one administer tile is visible. This changes the nav slightly and makes `portal-nav.test.tsx`'s "appended last, gated solely on `org_portal.admin_hub`" test change. It also means the nav now needs the administer tile read. Those reads are `cache()`d per tile (`visible-tiles.ts:62`), so the cost is one extra tile pass per request, not extra queries.

The Administration column heading is plain text, for the same reason as Note 1. Default: its first link is "Administration overview", pointing at `/o/<slug>/admin`. That keeps the hub reachable from the footer, and the nav pill already carries the same destination.

### Note 4: permission-blind Administration column

The footer would show every flag-visible administer tile to every member, on every page. A plain member would see Roles, Features, Branding, Manage events, Website domain and similar links, and each leads to a Forbidden page. The hub and the nav entry already do this, so it is not a new leak of data. It does reveal which optional features this org has turned on, since "Manage giving" and "Website domain" exist only when those toggles are on, but members can already see that on the hub.

Filtering by permission would add a second gate and contradict DECISION-003 and DECISION-162, which is a larger decision than this pipeline. Default is Q1 below: stay permission-blind, and add a TODO line recording the follow-up that a "can administer" signal would let the footer hide the column for viewers who cannot use it.

### Note 5: existing tests and e2e that will break

- **`portal-footer.test.tsx`.** The tests "calls visiblePortalTiles with the 'operate' category, never 'administer'" (129–133) and "recaps every visible tile" (141–146) assert the flat design. They must be rewritten. The footer will call both categories, so the mock must return per-category results. The `<nav aria-label="Footer">` landmark and the "Home" link assertions can stay. Contact-info and copyright tests are unchanged.
- **`layout.test.tsx`** pins `PortalFooter` receiving the same props and DECISION-040's "never rendered for forbidden, ended, not-found or no-session". Keep these green. The footer is the surface an Administration column must never leak on.
- **`e2e/community-participants.spec.ts:283`** uses `getByRole("heading", { name: "Community" })` with no `exact: true`. If footer column titles are `<h2>`, that matches both the page H1 and the footer heading and throws a strict-mode violation. The same pattern can bite `e2e/branded-signin.spec.ts:253` (heading "Directory"). Tighten both locators to `level: 1` or `exact: true` in Phase 4. The alternative is non-heading titles (a `<p id>` with `<ul aria-labelledby>`), which is less accessible. Default: real `<h2>` headings and tightened locators.
- **`e2e/member-calendar.spec.ts:260`.** For a manager on the calendar page, `getByRole("link", { name: "Manage events" })` is `toBeVisible()`. The page has its own "Manage events" link, and the footer adds a second, so it throws on two matches. Scope the locator to `main` or the calendar region. Line 267 (`toHaveCount(0)` with the flag off) stays valid, since the footer hides the tile too. Line 243 (`/^Calendar\b/` count 0 when the toggle is off) stays valid.
- No e2e currently asserts footer text, because `grep` finds no footer locators, so there is no regression floor for the footer in e2e. Add one smoke at the portal home covering a member's footer columns and, at 360px, no horizontal scroll.

### Note 6: empty and sparse states

- Zero visible operate tiles and no Administration: the footer shows Home, contact info and copyright. This is the existing floor, and Home is unconditional. A domain with no visible tiles is omitted, which is correct and matches `DomainTileSections`.
- The "Directory and Calendar only" case is two short columns (Community, Worship & Events) plus Home. That is fine. If the viewer also sees Administration (Note 4), that column dominates the footer and reads as three equal columns.
- A brand-new install has most flags off, so the footer is mostly Home plus contact info. The existing contact-info omission rule ("no empty bordered section") must be kept for the new columns too: no empty `<ul>`, no heading without items.
- Contact block, copyright and `tel:` link are untouched. They keep `text-base` for address and phone and `min-h-11` for targets (`portal-footer.tsx:106-120`).

### Note 7: mobile, 360px

- Do not force seven columns in one row. A presbytery can see up to Community, Worship, Governance, Reports, Communications plus Administration. Use a wrapping grid, roughly `grid-cols-2` at 360px, `sm:grid-cols-3`, `lg:grid-cols-4`, rather than a fixed column count.
- Long labels ("Per-Capita, SASR & Imports", "Worship & Service Planning") must wrap, not truncate or overflow.
- Keep the 44px touch targets (`min-h-11`). A heavy congregation view is about 14 links, which is about 7 rows at two columns, an acceptable height.
- Do not make columns collapsible with `<details>`. CLAUDE.md's Verify-in-a-Browser invariant records an iOS `<details>`/`<summary>` failure in this project. A plain stack or grid is enough.
- Verify in a browser at 360px. `next build` passing is not evidence.

### Note 8: brand contract

The footer renders inside `(org)/o/[slug]/layout.tsx` and inherits `<BrandTokens>` through the cascade. It lives under `src/components/`, so it must not use any `*-brand[-*]` utility, because `check-brand-scope.mjs` rule C1 forbids that outside `(org)`/`(public)`. Stay on the semantic tokens already used: `text-muted-foreground`, `text-foreground`, `border-border`. Column headings are `text-foreground font-semibold`. Keep the focus ring with the 2px offset on every link, and body text at 7:1. Do not introduce a `bg-primary` fill in the footer, because the fill is reserved for the active nav pill. Run `npm run check:brand-scope`.

### Other notes

- **Phone link.** `tel:${profile.phone}` interpolates free text from `organization_profiles` (existing, `portal-footer.tsx:115`). The `tel:` prefix makes it a non-script scheme, so this is low risk. It is out of scope and is mentioned only in case the footer is rewritten.
- **Cost per request.** The layout runs on every portal page. The footer would make `visiblePortalTiles` calls for both categories, and the nav would too after Note 3, so each of the 22 tiles gets one cached flag read, plus toggle reads for calendar, giving, giving-admin and domains. `cache()` dedupes across the nav, the footer and the home page. The layout test should assert that the footer makes both calls and that a failed read hides only that tile.
- **No audit event.** The change is read-only, so there is none. Nothing security-sensitive is mutated.
- **2FA.** The proxy redirects a user mid-enrolment to `/totp` before the layout renders, so the footer never shows there.
- **What's-new.** The rename and the footer are member-visible. At Phase 6, publish a `whats_new_entries` entry under Workflow Rule 13. Also update `docs/product/functionality-map.md` (the org portal bullet) per Rule 14.

## Pass 5: Adversarial

- **Redirect targets.** None. All hrefs come from the registry's `href(slug)` using the slug of the resolved org. There is no user-controlled `next` or `callbackUrl`. Confirmed.
- **State-machine shortcuts.** Footer links skip nothing: each destination re-authorizes and re-checks its own flag and toggle. Confirmed by the design comment at `tiles.ts:21-58`.
- **Enumeration leaks.** The footer must keep rendering only inside the `resolved.kind === "ok"` branch (DECISION-040). `layout.test.tsx` already pins this for `forbidden`, `ended`, `not-found` and no session. Do not move the footer's tile reads outside that branch. The Administration column's contents (Note 4) are a gap, flagged above.
- **Input boundaries.** No user input. Org name and profile fields render as React text, which escapes. Confirmed.
- **Self-targeting.** n/a.
- **Hidden-gate drift.** The footer must not grow a permission check (Note 4), and the nav and footer must use the same Administration rule (Note 3). These are the two ways this feature could quietly create "two gates disagreeing", which is the defect DECISION-003 exists to prevent.

## The operator's question: is feature setup per organization?

**Partially.** What reaches the menu:

1. **Org type** is per organization. `tile.orgTypeScope` is checked first (`visible-tiles.ts:92-96`). For example, Credentials and Oversight appear only for presbyteries, and Giving only for congregations and NWCs.
2. **Platform flags** are global, not per org. Most tiles have a `flagKey` (`tiles.ts`), read through `isFlagEnabled` in `tileGateOpen` (`visible-tiles.ts:70`).
3. **Per-org toggles** (`organization_feature_toggles`, set on the Features page) reach `visiblePortalTiles` only for tiles that declare `orgFeatureKey`: **Calendar** (`tiles.ts:333`), **Giving** and **Manage giving** (`tiles.ts:406,417`), and **Website domain** (`tiles.ts:435`). Evaluation is `tileGateOpen` → `isOrgFeatureEnabled` (`visible-tiles.ts:76`) → `orgFeatureEnabledInTx` (`org-features.ts:314-345`), which composes org type, the category axis and the toggle row. A missing row means OFF (DECISION-097).
4. **The per-org category axis** (Features page's category on/off, `org-feature-categories.ts`) reaches a tile only through those same toggle-gated tiles, via `orgFeatureEnabledInTx`. Turning a category off therefore does not remove Directory, Groups, Staff, Officers or Roles from the menu. Those tiles ignore it. Of the Features page categories, only Worship (via Calendar) and Giving have any effect on the menu today.
5. **Members tile.** Its tile has only `flagKey` (`tiles.ts:229`), so the `members_create` catalog toggle (`org-features.ts:65-79`) does not hide the tile. The destination page checks the toggle itself. The tile can therefore appear for an org whose toggle is off and land on an "off" state. This is existing behaviour, but the footer would now repeat it on every page. Record it as a follow-up; it is out of scope here.

So the operator's instinct is right that "setup is per organization", but only 4 of 22 tiles actually vary by per-org toggle. The titles the operator saw differing were not caused by per-org setup. They came from the nav and footer reading the same tiles two ways: the nav uses domain labels, and the footer uses tile labels.

## Out of Scope (confirm with operator)

- Permission-aware menus: hiding admin links from viewers who cannot use them (Q1).
- Reconciling the Members tile with its per-org toggle (item 5 above), and making the category axis affect Directory, Groups and the other flag-only tiles.
- Renaming the Community tile or page, or the `people` domain key.
- Scroll-spy or active-state for footer links.
- Public site footers, `/home`, and platform `/admin` footers. This is the portal's `(org)` footer only.
- Showing the Administration column in the nav as a dropdown.

## Open Questions

**Q1. Should the Administration column list every flag-visible administer tile to every member, as the hub and nav entry already do, or only to viewers who can use them?**
Default: show all, consistent with the existing permission-blind rule (DECISION-003/162). Add a TODO line for a future "can administer" signal. Changing the answer makes this a Feature-class pipeline with a new gate and a new DECISION, and Phase 1 would reopen. If you prefer, the lower-cost middle option is a footer Administration column that shows only the heading plus the "Administration overview" link and no individual tiles.

**Q2. The nav pill and the home card both read "Community" and go to different places on the home page. Accept that one residual, or rename the tile?**
Default: accept it. The tile stays "Community" because it matches the page H1 and the v0.39.0 rename. The footer heading is plain text so the footer itself has no duplicate link. The alternative is renaming the tile and the page H1 to "People", at the cost of `page.test.tsx:193`, `e2e/community-participants.spec.ts:283` and a reversal of last release's wording.

## Handoff

Next agent: **architect** (Phase 2). Please rule on:
- where the pure menu builder lives (near `visible-tiles.ts`, not in `tiles.ts`, because of F135);
- the nav and footer sharing it, including the Administration rule in Note 3;
- the DOMAIN_LABELS rename keeping the `people` key;
- whether `domain-tile-sections.tsx` should share the builder, or stay as is.

Phase 2 may not be skippable: the new shared structure is a structural change, but it needs no new dependency or directory. If the architect rules no structural change, record the skip with notation.

**Per-Phase Status row (for the orchestrator to record):**

| Phase | Owner | Status | Verdict | Date |
|---|---|---|---|---|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-23 |

Files read (all under `/Users/cshenso/git/presby-platform/presby-nav/`): `docs/work-log/2026-10-23-portal-sitemap-footer.md`, `src/lib/org-portal/tiles.ts`, `src/lib/org-portal/tiles.test.ts`, `src/lib/org-portal/visible-tiles.ts`, `src/app/(org)/o/[slug]/portal-nav.tsx`, `portal-nav-links.tsx`, `portal-nav.test.tsx`, `src/components/org-portal/portal-footer.tsx`, `portal-footer.test.tsx`, `src/app/(org)/o/[slug]/page.tsx`, `admin/page.tsx`, `layout.tsx`, `src/components/shared/domain-tile-sections.tsx`, `src/lib/org-features.ts`, `src/lib/org-feature-categories.ts`, `src/lib/community-labels.ts`, `docs/ui-standards.md`, `e2e/member-calendar.spec.ts`, `e2e/community-participants.spec.ts`.

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

# Phase 4 — Implementation

## Files Created

- `path/to/file` — purpose

## Files Modified

- `path/to/file` — what changed

## Schema Changes

- [Tables / columns added, or "none"]
- Applied via: `npm run db:push` / `npm run db:generate`

## Audit Events

- [Action key written when the security-sensitive mutation fires]

## Implementer Notes

[Tradeoffs taken, anything that diverged from the design and why.]

---

# Phase 5 — Verification (qa)

**Date:** YYYY-MM-DD
**Verified by:** qa

## Type Check

`npm run typecheck`: PASS / FAIL

## Unit Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [test name — error — file:line]

## End-to-End Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [...]

## Regression Tests Added

- [test name — file:line — guards against: brief description]

## Coverage on Critical Modules

- `src/lib/permissions.ts`: X%
- `src/lib/two-factor.ts`: X%
- `src/lib/flags.ts`: X%

## Feature-Gate Audit

*(Mandatory — see qa agent. Verified by reading route/action bodies, not by inferring from green tests. Write "no protected routes touched" if none.)*

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| [method + path, or action name] | yes / no | yes / no | `FEATURES.X` or n/a |

## Verdict

[PASS | FAIL | BLOCKED — name the unmet prerequisite]

*(Auth-touching diffs: PASS requires e2e against a real dev server with an MFA-enrolled seeded user; deferred e2e = BLOCKED.)*

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

[SHIP IT | SHIP WITH NOTES | NEEDS REWORK]

## ONE-LINE TAKE

> [The shipped feature in one honest sentence.]

## What's Working

- [Specific. The flow that works well and why.]

## Intent-vs-Shipped Diff

- Phase 1 said: [X]. Shipped: [Y]. Verdict: [matches | acceptable drift | regression]

## Edge Cases

- Empty state: [pass | fail | not applicable]
- Failure microcopy: [pass | fail]
- Permission gate: [pass | fail]
- Audit event: [pass | fail | not applicable]
- Mobile (360px): [pass | fail]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
