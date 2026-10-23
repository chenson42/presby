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
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-10-23 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementer named | 2026-10-23 |
| 4 — Implementation | full-stack-developer | Complete | Gates green; see Phase 4 | 2026-10-23 |
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

## Operator rulings (2026-10-23)

- **Q1, Administration column:** **"Heading + overview link".** The footer's Administration column shows its plain-text heading and one link, "Administration overview", to `/o/<slug>/admin`. It does not list the individual administer tiles. The column appears under the same rule as the nav's Administration entry (Note 3). No new permission gate (DECISION-003/162 stand).
- **Q2, two "Community" items:** **"Accept it."** The `people` domain label becomes "Community". The tile and its page stay "Community". Footer column headings are plain text, not links. The home page's pill-versus-card pair is an accepted residual.

---

# Phase 2 — Architectural Review (architect)

*Recorded verbatim by the orchestrator.*

## Verdict

**Approved with suggestions.** The design needs no new dependency, no new directory and no schema change. It adds one new module inside the existing `src/lib/org-portal/`, which is a structural change, so Phase 2 is not skipped. The design stays inside DECISION-003, DECISION-117, DECISION-125, DECISION-162 and F135. Phase 3 proceeds and must follow the rulings below.

## Placement

- **Where the pure builder lives: a new file, `src/lib/org-portal/portal-menu.ts`.** It must not go in `tiles.ts`.
  - It exports `buildPortalMenu(input)`, the `PortalMenu` and `PortalMenuEntry` types, and nothing else.
  - It has no `server-only` marker, no React and no database import. The precedent is `main-row.ts`.
  - It imports `DOMAIN_LABELS` and `DOMAIN_ORDER` from `tiles.ts` at runtime, and `type PortalTile` as a type only. Labels are not passed in as an argument, so there is no second copy of them that could drift.
  - The import goes one way only: `portal-menu.ts` imports `tiles.ts`, and **`tiles.ts` must never import `portal-menu.ts`**. The F135 cycle runs tiles → org-features → org-feature-categories → tiles. `portal-menu.ts` sits outside that cycle and imports nothing from `org-features`.
  - `tiles.ts` loads `server-only`, so the builder's test mocks it with one line, `vi.mock("server-only", () => ({}))`. `tiles.test.ts:41` already does this. No other mocks are needed.
- **Where the reads live: one loader, `getPortalMenu(slug, organizationType, viewer)`, added to `src/lib/org-portal/visible-tiles.ts`.** That file is already the server-only half that evaluates tiles.
  - The loader reads the operate tiles, `org_portal.admin_hub`, and the administer tiles only when `admin_hub` is on. It then calls the builder.
  - The nav and the footer each call the loader. Neither repeats the reads or the Administration rule itself.
  - This keeps each piece of chrome independent, which both component headers document (a degraded footer must not take the nav down, and the reverse). It also means the two read through one code path.
  - The loader does not need `cache()`, because every read under it is already cached. If Phase 3 adds a cache, it must use primitive arguments, because an object argument defeats `cache()` (see the `visible-tiles.ts` header).
- **Builder input:** `{ slug, operateTiles, administerTiles, adminHubEnabled }`.
- **Builder output must be plain, serializable data**: strings and booleans only, with every `href` already turned into a string.
  - Each entry is `{ key: "home" | PortalDomain, label, href, exact, icon, children: { key, label, href, comingSoon }[] }`.
  - No `href(slug)` function and no icon component may appear in the output. The nav hands its data to the `'use client'` component `PortalNavLinks`, and a non-plain object crossing that boundary has already caused a live 500 once (see the `portal-nav-links.tsx` comment on `icon`).
  - The builder defines its own types and must not import `PortalNavEntry` from the client file. `portal-nav.tsx` converts menu entries into `PortalNavEntry` with a one-line map.
- **Server vs client split:** no change. `portal-nav.tsx` stays a Server Component with the existing client component for active state. `portal-footer.tsx` stays a Server Component, because nothing in the site map is interactive. The builder is never imported by a client component.
- **Dependencies:** none.

## Rulings on the questions put to Phase 2

1. **Home and Administration become first-class entries in the menu.** This removes the three hard-coded literals at `portal-nav.tsx:116,123-132` and `portal-footer.tsx:125-132`.
   - Home comes first, always shows, and has no children. The footer renders it as a link, not as a column.
   - Administration comes last. Its label comes from `DOMAIN_LABELS.administration`.
   - Under operator ruling Q1, Administration's `children` is exactly one link, "Administration overview", pointing to `/o/<slug>/admin`.
   - The builder uses `administerTiles` only to check that at least one exists. It never copies an administer tile into `children`. That makes the Q1 ruling a property of the data, not something the footer has to remember.
2. **One Administration rule (Note 3):** Administration is present if and only if `adminHubEnabled` is on **and** `administerTiles.length > 0`.
   - The rule lives only in `buildPortalMenu`.
   - This changes the nav's behaviour on purpose. The `portal-nav.test.tsx` test pinning "gated solely on `admin_hub`" gets rewritten, and the header comments that say so must be corrected (`portal-nav.tsx` and the `tiles.ts` comment on `PortalDomain`).
   - `/o/<slug>/admin` itself is unchanged. It keeps its own `admin_hub` gate and its "Nothing is turned on here yet." empty state for anyone who goes there directly.
   - Showing Administration still checks no permissions (DECISION-003/162 reaffirmed). The menu must never gain a `hasFeature` call or a check on the viewer's grants.
3. **The `administration` domain never becomes a domain entry.** The builder applies this standing rule, so it now lives in one place instead of a filter in `portal-nav.tsx`.
4. **Rename only the `DOMAIN_LABELS.people` value**, from "People & Membership" to "Community". The key `people` stays.
   - The key is the `#domain-people` anchor, the icon map key, and the value stored as `organization_feature_categories.category`.
   - I checked that the label text is stored nowhere in the database: "People & Membership" appears only in `tiles.ts`, in a comment at `org-features.ts:70`, and in `docs/product/functionality-map.md`. No migration is needed, and no catalog read on a live branch is needed because no schema, RLS policy or grant changes.
   - Also update the trailing comment on the `PortalDomain` union, and update the functionality map at ship time (Rule 14).
   - The Features-page category header will also read "Community". That follows from the operator's Q2 ruling, so it is not a defect.
5. **`domain-tile-sections.tsx` does not share the builder.**
   - It is generic over its domain type and serves three callers, including the platform `/admin` with its own taxonomy (DECISION-125). Making it read an org-portal menu would undo that.
   - Its headings already match because the home page gives it the same `DOMAIN_ORDER` and `DOMAIN_LABELS` and the same operate tiles.
   - Parity is covered by a test instead (item 6).
6. **The parity test has two parts.**
   - **`src/lib/org-portal/portal-menu.test.ts`, pure, with no mocks besides `server-only`.** It must cover:
     - the Note 3 truth table: hub off or on, crossed with zero or at least one administer tile;
     - the `administration` domain never appearing as a domain entry;
     - an empty domain being left out;
     - domain order following `DOMAIN_ORDER`;
     - `comingSoon` carried through to children;
     - top-level labels being unique;
     - Home first and Administration last;
     - no administer tile label appearing in any `children` (Q1);
     - every `href` being a string.
   - **A render parity test.** Give the nav and the footer the same mocked `getPortalMenu` result. Assert that the nav's labels, in order, equal the footer's Home link followed by its column headings, in order.
   - **Optional third assertion, which I recommend.** For one operate-tile fixture, every domain entry's `#domain-<key>` fragment matches a `<section id>` that `DomainTileSections` renders for the same tiles. That pins the anchor link to its target without coupling the two components.
7. **Per-request read cost: this corrects Phase 1.** Phase 1 said the administer pass costs "no extra queries". That holds only on `/o/<slug>/admin`, which already reads those tiles.
   - Each call to `isFlagEnabled` is one row read per key, cached per key within one render (`flags.ts:19`). On every other portal page, Note 3 adds:
     - about 6 flag reads not cached today (`roles`, `tickets`, `features`, `branding`, `events`, plus `reports` or `filings` depending on org type);
     - one per-org toggle read inside `withOrgContext` (`org_portal.domains`). The `org_portal.giving` read is already cached by the operate Giving tile.
   - The reads run in parallel on the WebSocket pool, are deduplicated across nav, footer and page, and happen only inside the `resolved.kind === "ok"` branch. I accept the cost.
   - **Required mitigation:** the loader skips the administer read entirely when `admin_hub` is off.
   - If the cost ever matters, the fix is a single cached read of all flags in `flags.ts`. That is out of scope, so log a TODO line only if Phase 3 measures a problem.

## Invariants Touched

- **Permissions vs Flags (DECISION-003/162):** kept. The menu remains flag-, toggle- and org-type-gated, and each destination stays the only authority on permissions. The analyst's Note 4 "can administer" follow-up stays a TODO line, not part of this pipeline.
- **Enumeration safety (DECISION-040):** kept, provided the nav and footer, and so `getPortalMenu`, are only rendered inside the `layout.tsx` `resolved.kind === "ok"` branch. The existing `layout.test.tsx` pins for forbidden, ended, not-found and no-session cases must stay green.
- **The Brand Is a Cascade Override (DECISION-047):** kept. The footer stays under `src/components/org-portal/` and uses semantic tokens only, with no `*-brand` utility and no `bg-primary` fill. `check:brand-scope` must pass.
- **Verify in a Browser:** the 360px layout check and the rule against collapsing columns with `<details>` (Note 7) are binding on Phase 4.
- **F135 (import cycle):** kept by the one-way import rule above.
- No invariant changes, so `CLAUDE.md` needs no edit.

## Notes

- **Proposed DECISION-220 (architectural, from the pre-assigned range):** "The org portal's menu is one pure structure, `buildPortalMenu()` in `src/lib/org-portal/portal-menu.ts`, which the nav and the site-map footer both render through `getPortalMenu()`. Home and Administration are members of it, not literals in the components. Administration is present if and only if `org_portal.admin_hub` is on and at least one administer tile is visible, and in the footer it carries only the 'Administration overview' link. The structure checks no permissions (DECISION-003/162). `tiles.ts` never imports it (F135). `DomainTileSections` stays generic and is held to the menu by a parity test, not by sharing the builder." Tech-lead may use DECISION-221/222 for implementation entries.
- State the "no two top-level entries share a label" rule once, in the header of `portal-menu.ts`. The home page's "Community" pill and "Community" card are the accepted residual from operator ruling Q2.
- Phase 1 Notes 5–7 are carried forward unchanged: the e2e locator tightening at `community-participants.spec.ts:283`, `branded-signin.spec.ts:253` and `member-calendar.spec.ts:260`; one new footer e2e smoke at 360px; the wrapping grid; and no empty `<ul>` or heading without items.
- The analyst flagged the `tel:` link and the Members-tile toggle mismatch. Both stay out of scope.

**Per-Phase Status row (for the orchestrator to record):**

| Phase | Owner | Status | Verdict | Date |
|---|---|---|---|---|
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-10-23 |

**Handoff:** next agent is **tech-lead** (Phase 3). The design doc must name `portal-menu.ts` and the `getPortalMenu` loader, implement Rulings 1–7, and pick the implementer. My expectation is full-stack-developer, since the change spans one lib module and two server components and is small.

Files reviewed (all under `/Users/cshenso/git/presby-platform/presby-nav/`):
- `docs/work-log/2026-10-23-portal-sitemap-footer.md`
- `src/lib/org-portal/tiles.ts`
- `src/lib/org-portal/visible-tiles.ts`
- `src/lib/org-portal/main-row.ts`
- `src/lib/flags.ts`
- `src/lib/org-features.ts`
- `src/app/(org)/o/[slug]/portal-nav.tsx`
- `src/app/(org)/o/[slug]/portal-nav-links.tsx`
- `src/app/(org)/o/[slug]/layout.tsx`
- `src/app/(org)/o/[slug]/page.tsx`
- `src/app/(org)/o/[slug]/admin/page.tsx`
- `src/components/org-portal/portal-footer.tsx`
- `src/components/shared/domain-tile-sections.tsx`
- `vitest.config.ts`
- `drizzle/` (grep for the stored-label check)

---

# Phase 3 — Technical Design (tech-lead)

*Feasibility checked against the live `presby-nav` tree on 2026-10-23: no SQL, no schema, no new FK, no new dependency. The one cycle risk (F135) is handled by the one-way import below.*

## Summary

The portal nav and footer will render one pure menu structure instead of reading the tile registry two ways. `buildPortalMenu()` (new, `src/lib/org-portal/portal-menu.ts`) turns already-resolved tiles into a plain list of entries (Home, one per non-empty domain, Administration), and `getPortalMenu()` (added to `visible-tiles.ts`) does the reads and calls it. The nav renders each entry as a link; the footer renders Home as a link and every other entry as a column with a plain-text heading. The `people` domain label becomes "Community" (key unchanged). Administration follows one rule in both places, and in the footer it carries only an "Administration overview" link (operator Q1). This implements Phase 2 Rulings 1–7 and proposed DECISION-220 as written; nothing here departs from them.

## Permissions & Flags

- Permission key(s): none. The menu checks no permission (DECISION-003/162); each destination stays the sole authority. No `hasFeature` call may appear in `portal-menu.ts`, `getPortalMenu`, the nav or the footer.
- Default role bindings: none.
- Feature flag(s): not needed. Existing `org_portal.chrome_v2` (nav), `org_portal.chrome_v3` (footer) and `org_portal.admin_hub` (Administration) keep their meanings. No new flag (operator standing rule).

## API Contract

No routes or server actions. Two internal contracts.

**Builder** — `src/lib/org-portal/portal-menu.ts`. Pure; no `server-only`, no React, no DB. Imports `DOMAIN_LABELS`/`DOMAIN_ORDER` (runtime) and `type PortalTile`/`PortalDomain` from `./tiles`; imports nothing from `org-features`, `visible-tiles` or any client file. `tiles.ts` must never import it (F135). Exports only `buildPortalMenu`, `PortalMenu`, `PortalMenuEntry`, `PortalMenuChild`.

```ts
buildPortalMenu(input: {
  slug: string;
  operateTiles: readonly PortalTile[];     // already filtered by visiblePortalTiles("operate")
  administerTiles: readonly PortalTile[];  // [] when the loader skipped the read
  adminHubEnabled: boolean;
}): PortalMenu                              // readonly PortalMenuEntry[]

interface PortalMenuChild { key: string; label: string; href: string; comingSoon: boolean }
interface PortalMenuEntry {
  key: "home" | PortalDomain;
  label: string; href: string; exact: boolean;
  icon: "home" | PortalDomain;              // always equal to key; kept so the nav map is one line
  children: PortalMenuChild[];
}
```

Output is strings and booleans only (no `href(slug)` function, no icon component), because the nav hands it to a `'use client'` leaf (the live-500 precedent in `portal-nav-links.tsx`). Rules, all in this one function:

1. **Home** first, always: label from a `HOME_LABEL = "Home"` constant in this file, `href /o/<slug>`, `exact: true`, `children: []`.
2. **Domain entries**, in `DOMAIN_ORDER`, for every domain except `administration` that has at least one operate tile (`tile.domain`): label `DOMAIN_LABELS[domain]`, `href /o/<slug>#domain-<domain>`, `exact: true`, `children` = that domain's tiles in input order as `{ key: tile.key, label: tile.label, href: tile.href(slug), comingSoon: tile.comingSoon === true }`. An operate tile whose domain is `administration` is dropped (standing rule, now stated once here).
3. **Administration** last, present if and only if `adminHubEnabled && administerTiles.length > 0`: key and icon `"administration"`, label `DOMAIN_LABELS.administration`, `href /o/<slug>/admin`, `exact: false`, `children` exactly one item `{ key: "administration-overview", label: ADMIN_OVERVIEW_LABEL, href: /o/<slug>/admin, comingSoon: false }`. `administerTiles` is used only for `.length`; it is never copied into `children` (so Q1 is a property of the data).
4. The file header states once: no two top-level entries share a label, and the home page's "Community" pill and "Community" card are the accepted residual (Q2).

**Loader** — added to `src/lib/org-portal/visible-tiles.ts` (server-only, already imports `isFlagEnabled`):

```ts
getPortalMenu(slug: string, organizationType: OrganizationType, viewer: TileViewer): Promise<PortalMenu>
```

Reads `visiblePortalTiles("operate", …)` and `isFlagEnabled("org_portal.admin_hub")` in parallel, then reads `visiblePortalTiles("administer", …)` **only if the hub flag is on** (Ruling 7 mitigation), then calls `buildPortalMenu`. No new `cache()` (every read under it is already cached; if one is ever added it takes primitive arguments). It never throws: `isFlagEnabled` returns false on error and `visiblePortalTiles` swallows gate failures, so a failed read hides a tile or Administration and never takes the chrome down. The nav and footer each call it independently (each stays self-sufficient, as both headers document).

## Data Model

No schema changes required. "People & Membership" is stored nowhere in the database (architect-verified); `people` stays the CHECK value, the `#domain-people` anchor and the icon key. No migration, no Neon branch.

## Component / Page Plan

- Pages to create: none.
- Files to create: `src/lib/org-portal/portal-menu.ts`, `src/lib/org-portal/portal-menu.test.ts`, `e2e/portal-footer-sitemap.spec.ts`.
- Files to modify:
  - `src/lib/org-portal/tiles.ts` — `DOMAIN_LABELS.people` to "Community"; update the `PortalDomain` union comment (line 114), the stale "nav hardcodes Administration" paragraph in the `PortalDomain` doc, and the comments at lines ~278 and ~296.
  - `src/lib/org-portal/visible-tiles.ts` — add `getPortalMenu`.
  - `src/app/(org)/o/[slug]/portal-nav.tsx` — a Server Component that calls `getPortalMenu` and maps each entry to `PortalNavEntry` (`{ label, href, exact, icon }`). It drops its `isFlagEnabled`, `tiles` and domain computation, and its header comment is rewritten (no more "Home/Administration are hardcoded", no more "gated solely on the flag").
  - `src/components/org-portal/portal-footer.tsx` — calls `getPortalMenu`; layout below; header comment rewritten (it still says the footer calls `"operate"` only and is a flat recap).
  - `src/lib/org-features.ts:70` — comment only.
- Unchanged on purpose: `portal-nav-links.tsx` (its `PortalNavEntry` type already fits), `layout.tsx` and its props (still renders both only inside `resolved.kind === "ok"`; DECISION-040), `domain-tile-sections.tsx` (Ruling 5), `org-feature-categories.ts`.

**Footer layout** (Server Component, no `'use client'`, no `<details>`):
- Order: contact block (unchanged), `<nav aria-label="Footer">`, copyright (unchanged).
- Inside the nav: first the Home link (a plain link row, `min-h-11`), then `<div class="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">`. Home is not a column.
- One `<div class="min-w-0">` per entry that has at least one child, containing `<h2 id="footer-menu-<key>" class="text-sm font-semibold text-foreground">` (plain text, never a link) and `<ul aria-labelledby="footer-menu-<key>">`. An entry with no children renders no column, so there is never a heading without items or an empty `<ul>`.
- Each link: `flex min-h-11 flex-wrap items-center gap-x-2 py-1 break-words`, plus the existing hover and focus-ring classes (2px offset). A `comingSoon` child adds `<span class="text-sm">Coming soon</span>` inside the link (muted, no badge fill).
- Semantic tokens only (`text-muted-foreground`, `text-foreground`, `border-border`); no `*-brand` utility and no `bg-primary` fill. Run `npm run check:brand-scope`.

**360px layout.** The container is `px-6`, so about 312px of content, which gives two columns of about 144px with a 24px gap. A seven-entry presbytery view (Community, Worship & Events, Governance & Courts, Reports & Insights, Communications, Administration, plus Giving where in scope) stacks to about four rows of columns. Long labels ("Worship & Service Planning", "Committees & Commissions", "Congregation Oversight", and a heading like "Governance & Courts") wrap inside their column (`min-w-0`, `break-words`) and never truncate. Targets stay 44px high. Acceptance: `document.documentElement.scrollWidth <= clientWidth` at 360x800, and no link under 44px tall. At `sm` (640) three columns, at `lg` (1024) four.

## Copy

Every user-facing string this change adds or changes. All plain text, no punctuation tricks.

| Where | String |
|---|---|
| Domain label (nav pill, home section heading, footer column heading, Features page category header) | **Community** (was "People & Membership") |
| Other domain labels (unchanged, now also footer headings) | Worship & Events · Giving & Finance · Governance & Courts · Reports & Insights · Communications |
| Home link, nav and footer | Home |
| Administration, nav pill and footer column heading | Administration |
| Footer Administration link | Administration overview |
| Footer link to a tile that is not built yet | the tile's own label, then the words "Coming soon" |
| Footer landmark label | Footer (unchanged) |
| Footer contact block, copyright | unchanged |

No new errors, toasts, dialogs or emails. Release-note entry (draft; Phase 6 / `/release-notes`):

> **The portal footer is now a site map, and "People & Membership" is now "Community".** The footer lists each section of the portal as a column with its tools underneath, using the same section names as the menu at the top of the page. The "People & Membership" section is now called "Community" everywhere it appears, including the Features page. The Administration link in the menu and footer now shows only when your congregation has at least one administration tool turned on (before, it showed whenever the administration area was on). Everyone in the congregation sees the Administration link when it is shown; the pages behind it still check what each person is allowed to do. On the home page, the Community menu item and the Community card are separate links that lead to different places, and that is expected.

Read against the accepted residuals: it does not claim Administration is hidden from people who cannot use it (Q1/Note 4), it states the pill/card pair (Q2), and it does not mention the Members-tile toggle mismatch, which is out of scope and unchanged. The what's-new entry (Rule 13) reuses the first two sentences only.

## Existing tests and e2e to update

**Unit (vitest) — these assert the old design and must change:**
- `src/components/org-portal/portal-footer.test.tsx` — the mock becomes `getPortalMenu`. Rewrite the "nav recap" describe (lines 119–147): drop "calls visiblePortalTiles with the 'operate' category, never 'administer'" and "recaps every visible tile"; keep and adapt "always includes a Home link, even with zero visible tiles"; adapt "forwards organizationType" to forward `slug`/`organizationType`/`viewer` to `getPortalMenu`. Contact (69–118) and copyright (149+) are untouched.
- `src/app/(org)/o/[slug]/portal-nav.test.tsx` — the whole entry-construction suite moves to `portal-menu.test.ts`. This file shrinks to the mapping: mock `getPortalMenu` (drop the `tiles` and `flags` mocks); assert menu entries map to `label/href/exact/icon` with `children` and `key` not passed on, that slug/organizationType/viewer are forwarded, and that the result renders through `PortalNavLinks`. Remove: "calls visiblePortalTiles with 'operate', never 'administer'" (113), the anchor/order/collapse/exclusion cases (131–219), the admin-hub cases (221–250, 284–307), the icon-key case (251–283) and the presbytery-only block (309+); each is re-asserted in the builder test. The header comment ("gated solely on `org_portal.admin_hub`") is rewritten.
- `src/lib/org-features.test.ts:470` — a real assertion against the real `DOMAIN_LABELS` (DB-backed suite): `"People & Membership"` becomes `"Community"`. This is the only test that breaks on the rename alone.

**Unit — literal fixtures that still pass but should read "Community" so the fixtures stay honest (cosmetic, same commit):** `portal-nav-links.test.tsx` (218, 232, 252, 269, 281), `page.test.tsx` (74, 301), `admin/page.test.tsx` (66, 296), `domain-tile-sections.test.tsx` (27, 60), `features/features-list.test.tsx:44`, `features/page.test.tsx` (302, 333), `features/feature-categories-list.test.tsx` (42, 119). `tiles.test.ts:327` checks keys only and is unaffected.

**Must stay green untouched:** `layout.test.tsx` (mocks both components; props are unchanged and the DECISION-040 cases for forbidden, ended, not-found and no-session must still pass).

**e2e (Playwright):**
- `e2e/community-participants.spec.ts:283` — `getByRole("heading", { name: "Community" })` has no level, so with `chrome_v3` on it also matches the footer `<h2>Community</h2>` and fails strict mode. Change to `{ level: 1, name: "Community" }`. Check the sibling headings in that file the same way.
- **Correction to Phase 1 Note 5:** `e2e/member-calendar.spec.ts:260` needs no change. Under operator Q1 the footer lists no administer tiles, so there is no second "Manage events" link, and lines 243 and 267 stay valid. `e2e/branded-signin.spec.ts:253` (`heading "Directory"`) needs no change either: footer headings are domain labels and none contains "Directory". The implementer re-checks with a repo-wide grep of heading and link locators against the seven domain labels, "Home", "Administration" and "Administration overview" before closing; the grep run today (2026-10-23) finds none other.
- No e2e currently asserts nav or footer text, and none asserts "Administration", so nothing else breaks on the Note 3 rule change.

## New tests

- `src/lib/org-portal/portal-menu.test.ts` (pure; only `vi.mock("server-only", () => ({}))`, as `tiles.test.ts:41` does), using hand-built `PortalTile` fixtures plus one pass over the real `PORTAL_TILES`:
  - Administration truth table: hub off or on, crossed with zero or at least one administer tile (present only when both are true);
  - `administration` never appears as a domain entry, and an operate tile carrying `domain: "administration"` is dropped;
  - an empty domain is omitted; domain order follows `DOMAIN_ORDER`; Home first, Administration last; Home has no children;
  - `comingSoon` is carried to children and defaults to `false`;
  - top-level labels are unique; no administer tile label or key appears in any `children`; Administration's only child is the overview link;
  - every `href` and every other field is a string or boolean (a serializability check: `JSON.parse(JSON.stringify(menu))` deep-equals `menu`);
  - label sourcing: the "Community" domain entry's label equals `DOMAIN_LABELS.people`, and `DOMAIN_LABELS.people === "Community"`.
- `src/lib/org-portal/visible-tiles.test.ts` (extend, or create beside it if none exists): `getPortalMenu` skips the administer read entirely when `org_portal.admin_hub` is off (spy on `visiblePortalTiles`' gate), and returns Home plus operate domains with no Administration when the administer read is empty.
- Footer unit tests (in the rewritten `portal-footer.test.tsx`): one `<h2>` per entry with children, in menu order; each `<ul>` is labelled by its heading; headings are not links; no heading and no `<ul>` for an entry with no children; Administration column holds exactly one link, "Administration overview", to `/o/<slug>/admin`; a coming-soon child shows "Coming soon"; Home is a link and not a column; the footer has no `*-brand` class.
- **Render parity test** (new file `src/components/org-portal/portal-menu-parity.test.tsx`, jsdom): feed one mocked `getPortalMenu` result to both `PortalNav` and `PortalFooter` and assert the nav's link labels, in order, equal Home followed by the footer's column headings, in order.
- **Anchor parity** (same file, Ruling 6 third assertion): for one operate-tile fixture, every domain entry's `#domain-<key>` fragment matches a `<section id>` rendered by `DomainTileSections` for the same tiles.
- **e2e** `e2e/portal-footer-sitemap.spec.ts`: capture and restore `org_portal.chrome_v3` and `org_portal.admin_hub` with `e2e/support/flags.ts` (pattern of `portal-home-cards.spec.ts`), sign in as the alpha-org member, then at 360x800 assert the footer nav shows the "Community" `<h2>` and a "Directory" link; the footer has no horizontal overflow (`scrollWidth <= clientWidth`); every footer link is at least 44px tall; and with `admin_hub` on and one administer tile visible, the Administration column holds only "Administration overview", while with `admin_hub` off neither the nav nor the footer shows Administration. Repeat the no-overflow assertion at 1024. Phase 5 also verifies by eye in a browser at a phone viewport (Verify-in-a-Browser invariant).

## Implementation Order

1. Rename `DOMAIN_LABELS.people` and fix the comments in `tiles.ts` and `org-features.ts`; update `org-features.test.ts:470`.
2. `portal-menu.ts` and `portal-menu.test.ts` (green in isolation).
3. `getPortalMenu` in `visible-tiles.ts` and its test.
4. `portal-nav.tsx` and its shrunken test.
5. `portal-footer.tsx`, its rewritten test, then the parity tests.
6. Cosmetic fixture renames; tighten `community-participants.spec.ts:283`; new e2e.
7. `npm run typecheck`, `npm run lint`, `npm run test`, `npm run check` (in particular `check:brand-scope`), then the e2e run and a 360px browser pass.
8. At Phase 6, by the orchestrator at integration: release notes (suggest 0.40.0, a Feature) and `package.json`, what's-new entry (Rule 13), `docs/product/functionality-map.md` org-portal bullet (Rule 14), `docs/decisions.md` entries below, and the `docs/TODO.md` lines below. These touch Rule 16 files, so this pipeline does not edit them mid-flight.

No audit events (read-only). No `FEATURE_CATALOG` or seed change.

## Edge Cases & Risks

- **Cycle (F135).** Enforced by direction: `visible-tiles.ts` imports `portal-menu.ts`, which imports `tiles.ts`. The new unit test imports `portal-menu.ts` alone and so fails if `tiles.ts` ever imports it back or pulls in `org-features` (the mock list would no longer be enough).
- **Client boundary.** The menu has only plain data; `portal-nav.tsx` passes the existing four-field entries. The serializability test guards it. A browser pass is required because tsc and the build do not catch this class of defect.
- **Behavior change on purpose.** With `admin_hub` on and no visible administer tile, the nav's Administration pill disappears (it appeared before). `/o/<slug>/admin` still renders its "Nothing is turned on here yet." state for a direct visit.
- **Cost.** About six more flag reads per page, plus one per-org toggle read, only when `admin_hub` is on (Ruling 7). Accepted; no TODO unless measured.
- **Permission-blind column.** Every member sees "Administration overview" when it is shown (Q1). The follow-up for a "can administer" signal and the Members-tile toggle mismatch are TODO lines, not this pipeline.
- **Duplicate-label residual.** The home page's "Community" pill (to the section) and "Community" card (to `/admin/community`). Accepted (Q2). The footer has none (headings are not links).
- **Failed gate reads** hide that tile (and its whole column if it was the only one) and never throw; worst case is Home, contact info and copyright.
- **Public repo.** Fixtures and the e2e use only the existing synthetic alpha org; no real names or addresses.

## Out of Scope (confirm)

Listing individual administer tiles in the footer (Q1 ruled); permission-aware menus; reconciling the Members tile with its toggle; renaming the Community tile or page, or the `people` key; scroll-spy or active state in the footer; a nav dropdown for Administration; the `tel:` link hardening; public-site, `/home` and platform `/admin` footers; caching all flags in one read.

## Decisions

- **DECISION-220** stays the architect's (architectural) entry as proposed in Phase 2; no change.
- **DECISION-221 (implementation) — draft for the orchestrator to integrate:** "The footer is a site map built from `PortalMenu`: Home is a leading link; every entry with children is a column whose heading is a plain-text `<h2>` (never a link) and whose list is `aria-labelledby` that heading; an entry with no children renders no column. The grid wraps (2, 3, 4 columns at the base, `sm` and `lg` breakpoints) instead of fixing a column count, columns are never collapsible (the iOS `<details>` failure), and `comingSoon` children render the words 'Coming soon' as plain text. Rationale: the headings equal the nav's labels by construction, only one link is named 'Community' in the footer, and the layout cannot hide a link on a phone. Revisit if a presbytery's footer grows past about eight columns."
- **DECISION-222 (implementation) — draft:** "`getPortalMenu()` skips the administer-tile read when `org_portal.admin_hub` is off, and makes no new `cache()` of its own: the per-tile and per-flag reads under it are already cached on primitive arguments, so the nav, the footer and the page share them. The cost accepted is about six uncached flag reads and one toggle read per request when the hub is on. Revisit with a single cached all-flags read in `flags.ts` if it is ever measured as a problem."

**TODO lines to add at integration (Rule 10):** (1) a "can administer" signal so the footer and nav can hide Administration from viewers who cannot use it (Phase 1 Note 4); (2) the Members tile ignores the `members_create` toggle, so the tile can open an "off" state (Phase 1 Note 5, item 5); (3) the category axis does not affect Directory, Groups, Staff, Officers or Roles.

## Implementer

**full-stack-developer.** One lib module, one loader, two server components and their tests, about eight files in all; splitting across agents would cost more than it saves. The builder and its tests come first so the rest builds on a green base.

---

# Phase 4 — Implementation

## Files Created

- `src/lib/org-portal/portal-menu.ts` — pure `buildPortalMenu()` plus the `PortalMenu*` types; Home, domain entries, and the one Administration rule (DECISION-220).
- `src/lib/org-portal/portal-menu.test.ts` — 17 pure tests (truth table, ordering, Q1, serializability, label uniqueness over the real registry).
- `src/components/org-portal/portal-menu-parity.test.tsx` — render parity (nav labels equal Home plus footer headings, four menu shapes) and anchor parity against `DomainTileSections`.
- `e2e/portal-footer-sitemap.spec.ts` — footer at 360 and 1024, 44px targets, Administration column, hub-off, hub-on-with-no-administer-tile.

## Files Modified

- `src/lib/org-portal/tiles.ts` — `DOMAIN_LABELS.people` is now "Community" (key unchanged); `PortalDomain` doc and two tile comments rewritten.
- `src/lib/org-portal/visible-tiles.ts` — added `getPortalMenu()`; skips the administer read when `org_portal.admin_hub` is off.
- `src/app/(org)/o/[slug]/portal-nav.tsx` — now a thin map of `getPortalMenu()` to `PortalNavEntry`; header rewritten.
- `src/components/org-portal/portal-footer.tsx` — site-map footer (Home link, wrapping 2/3/4-column grid, plain `<h2>` headings, `aria-labelledby` lists, "Coming soon").
- `src/lib/org-features.ts` (comment), `src/lib/org-features.test.ts:470` ("Community").
- Tests: `portal-footer.test.tsx` rewritten; `portal-nav.test.tsx` shrunk to the mapping; `visible-tiles.test.ts` extended with `getPortalMenu` cases; "Community" fixture renames in seven other test files.
- e2e: `community-participants.spec.ts:283` tightened to `level: 1`; `member-calendar.spec.ts:159` scoped to `main` (see deviations).

## Schema Changes

- None. No migration, no Neon branch.

## Audit Events

- None (read-only).

## Implementer Notes

Deviations from the Phase 3 design:

1. **One more e2e locator needed tightening than Phase 3 predicted.** `e2e/member-calendar.spec.ts:159` used `getByRole("heading", { level: 2 })` unscoped and hit a strict-mode violation (7 elements) once the footer carried `<h2>` headings. Scoped to `getByRole("main")`. The Phase 3 grep looked at name locators only. I re-grepped for unnamed heading, `h2` and `ul` locators; `portal-home-cards.spec.ts:116` (`slice(0, 2)`) and `:223` (`.first()`) are safe.
2. `portal-nav.test.tsx` and the footer test mock `getPortalMenu` directly (as designed). The parity test mocks only the loader and runs the REAL `buildPortalMenu()`.
3. The e2e nav-Administration checks use a CSS locator (`nav[aria-label="Portal"] a`) because the nav links are `display:none` behind the Menu button at 360px.

Gates (worktree `presby-nav`):

- `npm run typecheck`: clean. `npm run lint`: clean (`--max-warnings=0`). `npm run check`: all eight tripwires pass, including `check:brand-scope`.
- `npm run test`: 506 files passed, 72 skipped (DB-backed); 7629 tests passed, 2158 skipped, 0 failed. New: 17 (menu) + 4 (loader) + 11 (footer) + 4 (nav) + 5 (parity).
- DB-backed `src/lib/org-features.test.ts` plus `src/lib/org-portal` (shared pipeline Neon branch, `--no-file-parallelism`): 155 passed, 2 failed. The two failures are 20 s timeouts in the "every axis x category x toggle combination" cases for `members_create` and `calendar`. They exercise the resolver, not labels, and are not touched by this change; the `categoryLabel` "Community" assertion at `:470` passed. Not re-run on a baseline.
- e2e, from a hardlinked scratch copy outside `~/git/presby-platform` on its own dev server (port 3111), chromium project:
  - `portal-footer-sitemap.spec.ts`: 6 passed (360 and 1024, plus 3 Administration cases).
  - `community-participants.spec.ts` (desktop and 360): 9 passed on the third run. The first two runs each failed one different test at a cold first-touch compile (30 s `connection-card` wait; 5 s "name & birth date" wait); a warm third run was green. Treat as dev-compile flake.
  - `member-calendar.spec.ts` (after the fix) and `portal-home-cards.spec.ts`: 26 passed together. `branded-signin.spec.ts` and `giving-admin.spec.ts`: passed (31 passed across the first three-spec run, with the one `member-calendar` failure fixed above).
  - Flags changed by the specs (`chrome_v2/v3`, `admin_hub`, tile flags) are captured and restored with SELECT verification; scratch copy and server removed.
- Browser look (real Chromium, 360x900 and 1280x900, home and `/directory`, most tile flags on): `scrollWidth - clientWidth = 0` on all four; 11 footer links, minimum height 44px; columns wrap (two at 360, four at 1280); long labels wrap; screenshots read correctly.

Not done here (orchestrator, Rule 16): release notes, what's-new, functionality map (`docs/product/functionality-map.md` lines 27 and 72 still say "People & Membership"), DECISION-220/221/222, and the three TODO lines.

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
