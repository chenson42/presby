# Avatar Menu and Organization Switcher — Work Log

> **Slug:** `2026-08-19-avatar-and-org-switcher`
> **Surface:** (member) + (org) shells — the signed-in header
> **Permission(s):** none new — reads existing session claims and the org list
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Polish class — Phase 2 skipped (no new dependency:
> `@radix-ui/react-dropdown-menu` is already in `package.json`; no schema, no API
> surface change), Phase 3 folded into Phase 1 below

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | orchestrator (inline) | Complete | READY FOR DESIGN | 2026-08-19 |
| 2 — Architectural review | architect | Skipped — no dep, no schema, no boundary change | — | 2026-08-19 |
| 3 — Technical design | folded into Phase 1 | Complete | — | 2026-08-19 |
| 4 — Implementation | ux-developer | Complete | — | 2026-08-19 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement

## Operator brief, 2026-08-19

> "i feel like when signed in you should have an avatar with a drop down menu to
> get to organizations, organization admin, super admin and profile" … "lets keep
> them separate and base them on google for now."

## The decision that shapes it

The four destinations are **two menus, not one**, and Google is the model:

- The **avatar**, top right, is *identity*. Who am I, my account, sign out. In
  Google this is where your name and email live and nothing about the current
  document or project.
- The **organization switcher** is *context*, and it is a separate control —
  Google Cloud's project picker, not the avatar. It answers "which congregation
  am I looking at," and it belongs where the context is, not where the identity
  is.

Fusing them is the tempting shortcut and it is wrong for the reason it is wrong
in Google: a pastor with two congregations changes *context* many times a
session and changes *identity* never.

## Where each destination goes

| Destination | Menu | Why |
|---|---|---|
| Switch organization | context | It is the context. |
| All organizations (`/orgs`) | context | The chooser is the full list behind the picker. |
| Organization admin | context | Scoped to the org you are in — it moves when you switch. **Not built until P9**; omitted rather than stubbed. |
| Account / profile | avatar | Identity. |
| Platform admin (`/admin`) | avatar | A property of *you*, not of the congregation you happen to be viewing. |
| Developer (`/developer`) | avatar | Same, gated on `is_platform_admin`. |
| Sign out | avatar | Identity. |

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Any signed-in page | See which organization I am in | continuous — it is ambient, not an action |
| Inside an org | Switch to another organization | several times a session for multi-org users |
| Any signed-in page | Reach my account | occasional |
| Platform admin | Reach `/admin` or `/developer` | occasional |
| Any signed-in page | Sign out | per session |

## Flows

**Flow 1 — switch congregation.** Inside `/o/e2e-alpha` → context control shows
"Wrenfield Presbyterian Church" → open → the user's other organizations listed →
pick one → land on that org's page.
- Failure: the org list can't be read → the control renders the current org name
  as plain text rather than a broken menu. Never an empty dropdown, which reads
  as "my access was revoked."

**Flow 2 — reach the platform surfaces.** Avatar → name and email → Account →
below a separator, Platform admin and Developer when entitled → Sign out.

## Gaps the request didn't address

- **A single-org user still needs the context control**, showing their one
  congregation, because it is the only ambient indicator of where they are. It
  simply has nothing to switch *to* — so it renders without a menu.
- **A user with no orgs has no context control at all.** Nothing to name.
- **`is_platform_admin` is read live, not from the session** — `developer/guard.ts`
  set that precedent deliberately so revocation takes effect immediately rather
  than at the next token refresh (DECISION-035 endorsed it). The avatar menu must
  not cache it into a claim to save a query.
- **Two entitlements, not one** (DECISION-044): `canAccessAdmin` gates the
  `/admin` item, `isPlatformAdmin` gates `/developer`. They are held by the same
  people today only by accident.
- **The header is the first place branding will bite** (S12–S14). This ships on
  the neutral palette; the brand pass is P0.5 and will re-skin it.

## Out of scope

- Multiple *identities* / account switching. One person, one account, many
  organizations — that is context switching, and Google's `/u/0/` machinery
  solves a problem presby does not have.
- The organization-admin destination, until P9 exists.
- Replacing `/orgs`. The chooser stays; the picker is a shortcut to it.

## Design notes for the implementer

- `dropdown-menu` is the fourth shadcn primitive. Slice B deliberately shipped
  three; this pipeline pulls one more forward because the menu genuinely needs
  it. `@radix-ui/react-dropdown-menu` is already a dependency, so this remains a
  zero-new-dependency change. It **will** arrive with `'use client'` — that is
  correct for this component and does not contradict P0's server-only ruling,
  which was about pages.
- The avatar is initials in a circle, derived from the session name or email. No
  image upload exists, and `people.photo_key` is not the platform user's avatar.
- Keyboard and focus behaviour come free from Radix and must not be hand-rolled.
- 360px: the context control truncates the organization name rather than
  wrapping the header.

---

# Phase 4 — Implementation

**Date:** 2026-08-19
**Implementer:** ux-developer

## Files Created

- `src/components/ui/dropdown-menu.tsx` — the fourth shadcn primitive, generated
  by `npx shadcn@latest add dropdown-menu`. One hand-correction: the umbrella
  import (see Findings F-1).
- `src/components/shared/org-switcher.tsx` — the context control (`'use
  client'`). Four renderings; picking between them is the whole component.
- `src/components/shared/avatar-menu.tsx` — the identity control (`'use
  client'`). Initials, name + email, Account, the two gated platform items,
  Sign out.
- `src/lib/initials.ts` — `initialsFrom()` and `accountLabel()`. Pure, not
  `server-only`; the avatar is a client component.
- `src/lib/auth/sign-out-action.ts` — `"use server"` module wrapping
  `signOut({ redirectTo: "/" })`. A client component cannot define a server
  action inline, and this repo already had four identical inline copies.
- `src/lib/nav-data.ts` — `cache()`-wrapped readers for the two values the
  header needs on every page.
- `src/app/(org)/o/[slug]/layout.tsx` — the organization shell (header +
  `<main>`), moved down one level so it can see `params.slug`.
- `src/lib/initials.test.ts`, `src/components/shared/org-switcher.test.tsx`,
  `src/components/shared/avatar-menu.test.tsx`,
  `src/components/shared/global-nav.test.tsx` — 54 unit tests.
- `e2e/header-controls.spec.ts` — 21 e2e tests.

## Files Modified

- `src/components/shared/global-nav.tsx` — rewritten. Still a Server Component;
  now `async`, reads the org list and `is_platform_admin` (each guarded
  independently), and renders the two client leaves. Takes `currentOrgSlug` and
  `contentWidthClassName` so the `(member)` and `(org)` shells can share it.
- `src/app/(org)/layout.tsx` — reduced to the page frame. It sits above
  `[slug]`, so it cannot name the organization and can no longer own the header.
- `src/app/(org)/o/[slug]/org-states.tsx` — dropped the portal stub's "Switch
  organization" button (Finding F-2).
- `src/app/(member)/orgs/page.tsx` — switched to the memoized readers so the
  header above it does not double both queries.
- `e2e/member-home.spec.ts` (tests 3 and 4), `e2e/post-login-routing.spec.ts`
  (test 12) — the bare header links they asserted are now menu items. Same
  destinations, same properties; the assertions moved behind a click.

## Schema Changes

None.

## Audit Events

None — the header performs no mutation. Sign-out is unchanged and was never
audited.

## Dependencies

**Zero installed.** `package.json` and `package-lock.json` are byte-identical to
`HEAD`, md5-verified before and after the `shadcn add`. `node_modules` was
restored with `npm ci`. See Finding F-1.

## Findings

### F-1 — the `radix-ui` umbrella came back, exactly as P0 predicted

`npx shadcn@latest add dropdown-menu` emitted
`import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"` and installed
`radix-ui@^1.6.7` (~40 sub-packages, 1,413 lockfile lines). Resolved the same
way P0's F-B1 did: reverted both dependency files, `npm ci`, and rewrote the
import to `import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"`.
A comment in the generated file now names the trap so the next `shadcn add`
does not have to rediscover it. **This is the second occurrence; P0.5 should
take the decision it deferred** — adopt the umbrella deliberately or keep
rewriting.

### F-2 — the design did not notice the P0 stub's duplicate control

`OrgPortalStub` carried an outline button reading **"Switch organization"** that
linked to `/orgs`. With the switcher in the header, `/o/<slug>` showed two
controls with the same words, one a picker and one a link to the chooser.
Removed. Nothing asserted it.

### F-3 — the specified degraded behaviour was not reachable as designed

Flow 1 says a failed org-list read should "render the current org name as plain
text". But the current organization's name *comes from* that list, so when it
fails there is no name left. Resolved with a second, narrower read on the
degraded path only: `publicOrgSummary(slug)` hits the `organizations` table
directly (no RLS policy, no SECURITY DEFINER function), so it can survive when
`presby_user_organizations()` does not. It discloses nothing the page beneath it
does not — DECISION-040 already has the access-denied page naming the
organization outright. If it fails too, the control renders nothing. **Never an
empty dropdown** either way.

### F-4 — "no menu for a single-org user" removes their only path to `/orgs`

Following the design literally, a user with one congregation, inside it, gets
plain text — and with the stub's button gone (F-2) there is now no link to
`/orgs` from anywhere on that page. In practice this costs them only the "still
being set up" notices, since `/launch` forwards them past the chooser anyway,
and the control becomes a menu by itself the moment a second relationship
exists. Shipped as designed; flagged for Phase 6 to accept or overturn.

### F-5 — Radix will close the menu out from under a `<form>`

`DropdownMenuItem` closes the menu from inside the item's click handler and
React flushes that discrete update synchronously, so the `<form>` can be
detached before the browser dispatches `submit` — and a detached form never
fires one. Sign-out would have silently done nothing. Fixed with
`onSelect={(e) => e.preventDefault()}`; the menu stays open until the redirect
navigates away, which is where the `useFormStatus()` pending state lives.
Guarded by a test.

### F-6 — an `/o/<slug>` page now issues one extra membership read

`resolveOrgContext()` calls `userOrganizations()` directly, so the header's
memoized read and the page's resolve are two round trips to
`presby_user_organizations()`. Deduplicating means memoizing inside
`src/lib/authz.ts`, where that call sits between two security comments — a
change for api-developer, not a drive-by from the client layer. `/orgs` and the
`(member)` pages pay nothing extra: `src/lib/nav-data.ts` shares one read.

## Implementer Notes

**Where the shell lives.** The header had to move into `o/[slug]/layout.tsx`
because a layout only receives `params` for its own dynamic segments, and
`(org)/layout.tsx` sits above `[slug]`. `(org)/layout.tsx` keeps the contract
comment and the page frame.

**`currentOrgSlug` is looked up in the user's own list, never trusted.** A slug
the user holds no relationship with simply does not match, so the access-denied
page shows the no-context rendering rather than labelling the organization the
user was just refused as "current".

**The switcher renders on pages with no organization** (`/home`, `/orgs`,
`/whats-new`) labelled "Organizations", listing every enterable organization
plus the chooser. This is what keeps `/orgs` reachable from the header after the
bare link was removed, and it is the Google Cloud "no project selected" state.

**Copy strings a fork's branding pass should review:** "Organizations" (the
no-context trigger label), "Switch organization" and "Your organizations" (the
switcher's two group headings), "All organizations", "Account", "Platform
admin", "Developer", "Sign out", "Signing out…", and the two screen-reader-only
strings "Current organization: " and "Account menu for {name}". Everything is on
the neutral palette; the only colour of consequence is the avatar circle
(`bg-primary` / `text-primary-foreground`).

**Touch targets.** Both triggers are 44px (the avatar is a 44px button around a
36px circle); every menu item carries `min-h-11`. Verified in the browser rather
than asserted from the class list.

**`collisionPadding={8}`** on both menus — at 360px a `w-72` panel opened from a
trigger 72px in landed flush against the right border and read as clipped.

## Verification performed

- `npm run typecheck` — pass
- `npm run lint` — pass (`--max-warnings=0`)
- `npx vitest run` — 559 passed / 44 files (505 before; +54)
- `npm run check` — both tripwires pass
- `npm run build` — pass
- `npm run test:e2e` — 84 passed (63 before; +21)
- Browser, against the dev server, at **360px and 1280px in both `light` and
  `dark`**, signed in as `org1-org2`, `org1`, `admin` and `member`: eight
  page/state combinations each, 32 screenshots, zero console or page errors.
  Checked: truncation at 360px, one-row header, menus inside the viewport,
  popover opacity and contrast in both schemes, the focus ring on both triggers
  in both schemes, and the four-way entitlement matrix.

---

# Handoff → Phase 5 (qa)

**What to click through in a browser** (dev server on :3000; fixture password in
`docs/testing.md`):

1. `org1-org2@presby.invalid` → lands on `/orgs` → open the header's
   organization control → pick Wrenfield → header now reads "Wrenfield
   Presbyterian Church" → open it again → the presbytery is listed, Wrenfield is
   not, "All organizations" is at the bottom. Escape closes it and focus returns
   to the trigger.
2. Narrow the window to 360px on `/o/e2e-presbytery`. The name must truncate
   with an ellipsis; the header must stay one row; the avatar must stay on
   screen. Then open each menu and confirm neither panel is clipped.
3. `org1@presby.invalid` at `/o/e2e-alpha` → the congregation's name as **plain
   text**, no chevron, no menu. Then `/home` → the same user now gets a menu,
   because there is somewhere to go.
4. `org1@presby.invalid` at `/o/e2e-beta` (access denied) → the header must say
   "Organizations", NOT "Thistledown Presbyterian Church".
5. `member@presby.invalid` at `/home` → **no** organization control at all, and
   the avatar menu holds only Account and Sign out.
6. `admin@presby.invalid` at `/home` → avatar menu holds Platform admin and
   **not** Developer (the fixture holds the session claim, not the column).
   Click Platform admin and confirm `/admin` admits rather than bounces.
7. Sign out from the avatar menu. It must land on `/` and actually be signed
   out — this is the one behaviour that had to survive unchanged, and F-5
   explains why it nearly did not.
8. Repeat 1 and 5 with the OS in **light** mode. Light mode has only worked
   since 2026-08-18 and is undertested by construction.

**Not done, deliberately:** `docs/TODO.md` and the functionality map are
untouched — a parallel pipeline (`2026-08-19-brand-foundation`) was editing
`docs/TODO.md` and `docs/decisions.md` during this work, and two agents writing
one file concurrently loses an edit. The TODO line and the map bullet belong in
the ship commit; whoever assembles it should add them.

**Findings needing a verdict rather than a test:** F-4 (a single-organization
user has no path to `/orgs` from inside their congregation) is the one place
this follows the design into a consequence the design did not state. F-1 is the
second occurrence of the umbrella problem and wants a P0.5 decision, not a fix
here.

**Next agent:** qa (Phase 5).
