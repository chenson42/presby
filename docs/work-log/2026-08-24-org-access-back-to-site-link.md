# Org access states link to the public site — Work Log

> **Slug:** `2026-08-24-org-access-back-to-site-link`
> **Surface:** (org)
> **Permission(s):** none — no new gate, purely a navigation affordance
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst (brief) | Done | Bug confirmed | 2026-08-24 |
| 2 — Architectural review | architect | Skipped | — | 2026-08-24 |
| 3 — Technical design | tech-lead (brief) | Done | — | 2026-08-24 |
| 4 — Implementation | full-stack-developer (in-session) | Done | — | 2026-08-24 |
| 5 — Verification | qa (in-session) | Done | PASS | 2026-08-24 |
| 6 — Shipped vs intent | analyst (brief) | Done | Confirmed | 2026-08-24 |

---

# Phase 1 — Functional Refinement (brief)

Reported directly by the user while manually testing the public-site feature
against the locally staged Alder Creek fixture: "when i go to the member
login it says i don't have access. there is no option to sign out and no
option to get back to the public site."

Two claims, checked separately against the running app rather than assumed:

- **"No option to sign out"** — checked live. The avatar menu (top right,
  initials, e.g. "EA") renders on `/o/<slug>` unconditionally, including on
  the access-denied state — `(org)/o/[slug]/layout.tsx`'s own doc comment
  says this is deliberate ("the header renders on the access-denied,
  relationship-ended and 404 pages too. That is the point"). Its dropdown
  has a working Sign out item. **Not a bug** — a discoverability gap at
  worst, and adding a second, page-specific sign-out control would be
  inconsistent with the one sign-out mechanism the rest of the app uses
  everywhere. No fix made for this half of the report.
- **"No option to get back to the public site"** — checked live, confirmed
  real. Neither `OrgAccessDenied` nor `OrgAccessEnded`
  (`src/app/(org)/o/[slug]/org-states.tsx`) has ever linked to
  `/site/<slug>`, only to `/orgs`. A visitor who followed a "Member Login"
  link from a congregation's public site, entered credentials, and landed on
  either of these states had no way back to where they started short of the
  browser Back button.

## Bug

`OrgAccessDenied` and `OrgAccessEnded` render only a "Back to your
organizations" link (`/orgs`). Both pages already have everything needed to
also link to `/site/<slug>` — the org's `slug` is the same route param the
page itself resolved through — but never did.

## Intended Fix

Add a second, secondary-styled link, "Visit the public site" →
`/site/<slug>`, next to the existing "Back to your organizations" button on
both `OrgAccessDenied` and `OrgAccessEnded`.

**Verdict: READY FOR DESIGN** (bug-fix variant — proceeding directly to
implementation per the brief-Phase-3 allowance below).

---

# Phase 2 — Architectural Review

**Skipped** — no schema change, no new dependency, no new route, no
directory restructuring. The one invariant this fix brushes against is
DECISION-040 (`docs/decisions.md`), addressed directly in Phase 3 below
rather than deferred to a separate review.

---

# Phase 3 — Technical Design (brief)

**DECISION-040 compliance, the only real design question here:** the
denial/ended pages must render byte-identically for a `managed`,
`invited`, and `unmanaged` relationship to the same org — the whole point
being that a prober looping over public slugs can't distinguish "not our
tenant" from "our tenant, you're just not on the roster." The org's `slug`
is not itself the secret (the org tree, and this exact page, already name
the organization); what must never vary is the *response*, across the three
statuses that collapse into "forbidden." A link to `/site/<slug>` is
identical text and identical href for all three, so it adds nothing
status-dependent and doesn't touch the property.

Second question: should the link be conditional on whether the site is
actually live (`organization_sites.status = 'live'`)? **No** — fetching
that to decide whether to show the link would itself be a second,
redundant status check of the exact kind DECISION-040 forbids this
component from making, and it doesn't need to be safe against showing a
dead link: `getPublishedSite()` already collapses "not provisioned" into
the same enumeration-safe 404 as every other not-live reason. A visitor
who clicks through to a site that isn't live just sees the ordinary
not-found page — the same posture this whole feature already takes
everywhere else.

**Data model:** none. **API contract:** none. **Component plan:** add a
`slug: string` prop to `OrgAccessDenied` and `OrgAccessEnded`
(`org-states.tsx`), render a second `Button variant="outline"` linking to
`/site/${slug}`. Every caller of these two components must be updated —
turned out to be six pages, not one, all sharing the identical
`resolveOrgContext` → `switch` pattern:
`(org)/o/[slug]/page.tsx`, `admin/roles/page.tsx`, `directory/page.tsx`,
`feedback/page.tsx`, `tickets/page.tsx`, `tickets/new/page.tsx`,
`tickets/[id]/page.tsx`. `tsc --noEmit` caught all six as compile errors
after the prop went from optional to required — the type system did the
completeness check here, not manual grep.

**Implementer:** handled in-session rather than dispatched to a separate
`full-stack-developer` invocation — small, single-file-pattern change
already fully scoped by the above.

---

# Phase 4 — Implementation

## Files Modified

- `src/app/(org)/o/[slug]/org-states.tsx` — `OrgAccessDenied` and
  `OrgAccessEnded` each gained a `slug: string` prop and a second
  `Button variant="outline"` linking to `/site/${slug}`, labeled "Visit the
  public site," alongside the existing "Back to your organizations" button.
- `src/app/(org)/o/[slug]/page.tsx`,
  `src/app/(org)/o/[slug]/admin/roles/page.tsx`,
  `src/app/(org)/o/[slug]/directory/page.tsx`,
  `src/app/(org)/o/[slug]/feedback/page.tsx`,
  `src/app/(org)/o/[slug]/tickets/page.tsx`,
  `src/app/(org)/o/[slug]/tickets/new/page.tsx`,
  `src/app/(org)/o/[slug]/tickets/[id]/page.tsx` — each already has `slug`
  in scope from its own route params; each now passes `slug={slug}` into
  the two components' `forbidden`/`ended` branches.
- `src/app/(org)/o/[slug]/org-states.test.tsx` — two new `describe` blocks
  asserting both components render a "Visit the public site" link to
  `/site/<slug>` alongside the existing "Back to your organizations" link.

## Schema Changes

None.

## Audit Events

None — no mutation, purely a rendered link.

## Implementer Notes

No behavior change for the "ok" (active relationship) path or for
`OrgPortalStub` — only the two denial/ended states gained the second link.
`tsc --noEmit` surfaced every caller that needed updating once `slug`
became a required prop; this is the intended failure mode for a prop-shape
change like this one (loud at compile time, not a runtime gap discovered
by a missing page).

---

# Phase 5 — Verification (in-session)

**Date:** 2026-08-24

## Type Check

`npm run typecheck`: PASS

## Tripwires

`npm run check` (audit-coverage, sql-date, deps-drift, brand-scope): PASS
— unaffected by this change, run as part of the full gate anyway.

## Unit Tests

Full suite: 1695 passed, 134 skipped (unrelated pre-existing skips), 0
failed.
`org-states.test.tsx` specifically: 11 passed (9 pre-existing + 2 new).

## Regression Tests Added

- `org-states.test.tsx` — "OrgAccessDenied — a way back to the public
  site" — asserts both the existing `/orgs` link and the new
  `/site/<slug>` link render with correct hrefs.
- `org-states.test.tsx` — "OrgAccessEnded — a way back to the public
  site" — same assertion for the ended-relationship state.

## End-to-End / Live Verification

Not a scripted e2e spec (small enough not to warrant a new Playwright
file), but verified against a real running dev server rather than trusting
the unit tests alone: signed in as the seeded `admin@presby.invalid` user
(no organizations, so guaranteed `forbidden` against a real congregation),
navigated to `/o/alder-creek`, confirmed the "You don't have access to
Alder Creek Presbyterian Church" heading, confirmed "Visit the public
site" renders with `href="/site/alder-creek"`, and confirmed clicking it
actually lands on the live `/site/alder-creek` page (not a 404, not a
client-side no-op — an earlier check of this same click appeared to fail
only because of a `waitForLoadState('load')` timing race in the
verification script itself, the same class of Playwright flake noted
elsewhere in this project's history; a proper `waitForNavigation` showed
the real navigation succeeds). Screenshot on file confirms both buttons
render correctly styled (primary "Back to your organizations", outline
"Visit the public site") alongside the working avatar/sign-out menu.

## Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `/o/[slug]` and its six sibling pages | yes (`cachedAuth()`, pre-existing) | n/a — no permission gate on this link, it's a public route the user is already entitled to see the name of | n/a |

## Verdict

PASS

---

# Phase 6 — Shipped vs Intent (brief)

**VERDICT: SHIP IT**

The reported gap — no way back to the public site from an access-denied or
relationship-ended state — is closed on both states, verified live against
a real sign-in. The "no sign-out option" half of the original report was
investigated and found to be a discoverability read of an existing,
working control (the avatar menu), not a missing feature — no change made
there, and that conclusion was reached by checking the live page, not by
assumption.

## Edge Cases

- Empty state: n/a.
- Failure microcopy: unchanged.
- Permission gate: n/a — no new gate introduced.
- Audit event: n/a — no mutation.
- Mobile (360px): not separately re-checked for this specific change (a
  two-button row with `flex-wrap`, consistent with patterns already
  verified responsive elsewhere on `(org)` pages this session); low risk,
  no new component introduced.

## Follow-Ups

- None identified.
