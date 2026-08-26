# Portal Chrome Refinements + Members Tile — Work Log

> **Slug:** `2026-08-26-portal-chrome-refinements`
> **Surface:** member — `(org)/o/[slug]` portal chrome
> **Permission(s):** none new (reuses `org_portal.members_create` for the new tile's gate)
> **Flag(s):** none new
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated (Polish class — visual/UX refinement to already-shipped chrome, no schema/API surface change). Phases 2 & 3 skipped with notation.
> **Source — user direction (2026-08-26):** "how do i get to the portal admin site? i also don't see any membership functionality yet. also the portal site's menu isn't responsive" · "and we should use the organization logo at a reasonable size. no need for the origanization name in text if you have the logo. logo should take you back to the piblic site"

## Scope

1. Add a "Members" tile to `PORTAL_TILES` (`src/lib/org-portal/tiles.ts`) pointing at `/o/<slug>/admin/members`, gated on `org_portal.members_create` — the member-management feature shipped 2026-08-25 with no home-tile/nav entry, making it undiscoverable outside a typed URL.
2. `GlobalNav`'s `orgMark` treatment: drop the organization-name text entirely when a logo is present (currently `OrgSwitcher` still renders the name as text next to the logo) and repoint the logo's link from `/o/<slug>` (portal home) to `/site/<slug>` (public site), per direct instruction. Confirm a "reasonable" logo size (the current render may be too small/cramped per the mobile screenshot).
3. Portal-nav mobile wrap: not overflowing (confirmed 0px horizontal overflow at 390px) but visually cramped — largely a byproduct of (2)'s header crowding; re-verify after (2) lands, address further only if still awkward.

Skipping Phase 2 (architect) — no new route, no schema, no new dependency, reuses an existing flag/permission exactly as an existing tile does. Skipping Phase 3 (tech-lead) — the fix shape is fully specified by the user's own instructions and the existing `PORTAL_TILES`/`GlobalNav` patterns.

## Implementation

Direct edit, verified live at 1280px and 390px. Tests updated (`tiles.test.ts`'s pinned snapshot, `global-nav.test.tsx`).
