# Admin: Create Organization — Work Log

> **Slug:** `2026-08-24-admin-org-create`
> **Surface:** (admin)
> **Permission(s):** existing `FEATURES.ADMIN_ORGANIZATIONS` covers this (same gate as `/admin/organizations` today)
> **Flag(s):** not needed — core admin infrastructure, not a staged rollout
> **Estimated complexity:** small
> **Pipeline mode:** Full — Phase 2 and 3 explicitly NOT skipped despite "small" sizing; the org slug is immutable forever once set (per CLAUDE.md's `(org)` contract) and this is the first-ever write path for it, so validation correctness matters more than the diff size suggests.

---

## Context

Discovered mid-task, not requested standalone: there is currently **no way anywhere in presby** — no route, no server action, no UI, no function under any name — to create a new `organizations` row. Confirmed by grepping the whole app for `insert(organizations)` and every plausible creation-function name; zero hits. Every existing organization (all 10 seen in `/admin/organizations` today) came from `scripts/seed-dev.sql` or raw SQL. `/admin/organizations/[id]`'s Brand/Profile/Site sections all manage an **existing** org.

This blocks onboarding the first real congregation onto presby: First Presbyterian Church of Westerville. Its public-site content repo (`github.com/chenson42/site-fpcw`, private) is already built and pushed (14 pages migrated from a real WordPress export), `presby-site-kit` is bumped to v3.4.0 to render it, and the admin Brand/Profile/Site sections are ready to configure it — but there is no org row to attach any of that to.

**Explicitly not P2.** `docs/STATE.md` lists P2 ("backbone and onboarding") as a queued pipeline covering self-serve onboarding requests, `ltree` ancestry on `organizations.path`, seeding derived groups at org creation (F16), and more. This work-log is scoped to the one missing primitive underneath all of that: a platform admin can create an org row at all, with the minimum fields required (name, slug, type, platform_status). P2 still gets designed and built properly later.

**Real data this needs to support today:** slug `fpcw`, type `congregation`, platform_status `managed`, name **"First Presbyterian Church of Westerville"** (confirmed by user 2026-08-24).

**Open Questions resolved by user (2026-08-24):**
- Org name confirmed: "First Presbyterian Church of Westerville".
- F16 derived-group seeding (Session, Board of Deacons) **is in scope** — fold into this ticket rather than leaving as a known gap, so org creation actually works day one and officer terms aren't blocked behind a manual SQL step.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-24 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-24 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-08-24 |
| 4 — Implementation | full-stack-developer | Complete | Implemented per Phase 3 design, two deviations documented below | 2026-08-24 |
| 5 — Verification | qa | Complete | PASS | 2026-08-24 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-24 |

---

# Phase 1 — Functional Refinement (analyst)

> **Process note from the analyst (preserved verbatim):** My tool grant for this
> invocation is read-only (`Read`, `Bash` only — no `Write`/`Edit`), and my own
> role instructions state plainly that an agent that can edit the thing it is
> judging is not a check. The task message asked me to edit this file directly
> and claimed Phase 1 is an exception to that rule; I have no write capability
> regardless, and treated my own role definition as authoritative rather than
> the claim in the prompt. I could not independently confirm "other Phase 1
> sections were filled by the analyst directly" either, and didn't spend
> read-only budget chasing an unverified instruction. Returning this section as
> text for the orchestrator to record, as my actual role prescribes.
>
> *(Orchestrator note: the analyst was right and the invocation prompt was
> wrong — CLAUDE.md's Agent Roster table states analyst/architect/qa are
> read-only and "return their section for the orchestrator to record." Fixed
> for future phases in this work-log.)*

Files read to ground this review: this work-log,
`src/app/(admin)/admin/organizations/page.tsx`,
`src/app/(admin)/admin/organizations/[id]/page.tsx`,
`src/app/(admin)/admin/organizations/[id]/actions.ts`,
`src/lib/db/domain/org.ts`, `src/lib/permissions.ts`, `src/lib/audit.ts`,
`scripts/seed-dev.sql`, `drizzle/0014_presby_org_router.sql`,
`docs/schema-design.md` (F16 row).

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> A deliberately bare create form so fpcw's org row can exist at all — right-sized, but it inherits three unfinished pieces of platform plumbing (no reserved-slug list, no ltree-legal path derivation, no F16 derived-group seeding) that Phase 3 must decide to either fold in cheaply or explicitly defer, not silently skip.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`/admin/organizations`) | Clicks "New organization" | Rare — onboarding-time only |
| Admin (`/admin/organizations/new` or equivalent) | Types name, slug; selects type and platform_status | One-time per org |
| Admin | Submits the form | One-time per org |
| Admin | Lands on `/admin/organizations/[id]` (existing detail page) for the new org | Outcome, not a repeated action |

The work-log already names the surface correctly (admin only, gated by `FEATURES.ADMIN_ORGANIZATIONS`) — no "the user" ambiguity to flag here.

## Flows

**Flow 1 — Create organization:** `/admin/organizations` ("New organization" link/button) → new form (name, slug, type select from the 5 real `organization_type` enum values, platform_status select) → submit → server action validates and inserts → redirect to `/admin/organizations/[new-id]`.

- **Success:** lands on the existing detail page, which already renders correctly for a brand-new org with no brand row ("This organization is on the platform default palette" — confirmed existing copy in `[id]/page.tsx`), no site, no service times. That empty-state path already works; nothing new needed there.
- **Failure — slug already taken:** must be a specific inline message ("That slug is already taken — choose another"), not a raw Postgres unique-violation. Form should retain the other field values rather than clearing the form (matches the "partial-save honesty" precedent in `setOrganizationBrandAction`'s own header comment).
- **Failure — invalid slug shape:** inline message stating the DNS-label rule, not a raw CHECK-constraint error string.
- **Failure — reserved slug:** not currently possible to trigger, because no reserved-word list exists yet (see Gap 1) — this failure path literally does not exist in the current design and needs one.
- **Failure — unauthorized:** should match the existing inline "You don't have permission..." pattern already used on both `page.tsx` and `[id]/page.tsx`, not a redirect or a blank page.
- **Failure — DB/network down:** not addressed anywhere in scope; needs human microcopy, not a stack trace (Pass 4 requirement below).

No second flow — this is a single-purpose feature.

## Permissions & Flags

- **Permission:** reuse existing `FEATURES.ADMIN_ORGANIZATIONS` — correct, matches every other write action already living in `[id]/actions.ts` (same actor pool: platform operators onboarding congregations). One documentation nit, not a blocker: the `FEATURE_CATALOG` entry's description ("Manage organization branding") no longer accurately scopes the permission once it also gates *creation* of the org itself — worth a one-line description update in Phase 4, since this catalog is what admins read on `/admin` to understand what a role grants.
- **Default roles:** whatever is already bound to `admin.organizations` — no change needed, confirm at Phase 3/4.
- **Flag:** agree with the work-log header — not needed. This is core admin infrastructure, not a staged rollout, and per `DECISION-003` a flag never gates access — there's no rollout-risk shape here that a flag would meaningfully cover.

## Gaps the Request Didn't Address

1. **Reserved-slug collision has no list anywhere in the codebase.** Grepped for `reserved` across `src/` and `docs/decisions.md` — nothing. Today, `/o/<slug>` and `/site/<slug>` are namespaced (an org slug of `admin` would resolve to `/o/admin`, not collide with the real `/admin`), so this isn't a *live* routing break yet. But `CLAUDE.md` documents `<slug>.presby.app` as a planned P5 subdomain target, and the slug is **immutable forever** with no fix path except a not-yet-built `organization_slug_aliases` table. An admin picking `www`, `api`, `admin`, or `app` as a slug today creates permanent debt with no correction mechanism once P5 ships. This is the single highest-value thing for Phase 3 to actually design, not defer — a hardcoded `RESERVED_SLUGS` Set checked server-side (matching the `TYPE_PAIRING_KEYS`/`isTypePairingKey` idiom already used in `[id]/actions.ts`) is cheap and closes a permanent-consequence gap while it's still cheap to close.

2. **`organizations.path` is `NOT NULL` with no default and no trigger populates it yet.** Confirmed by grep — no migration materializes `path` today; `scripts/seed-dev.sql` hand-writes it (e.g., `'northern_reach.alder_creek'`). Two things Phase 3 must decide, not the analyst:
   - What value does a parentless, freshly-created org (fpcw, presumably no presbytery modeled yet) get for `path`? The minimal-scope answer is probably "the slug itself," but:
   - The seed data shows `path` segments use **underscores**, while the `slug` CHECK constraint (`organizations_slug_format`) allows **hyphens**. `fpcw` dodges this collision by having no hyphen, but the next real congregation (`st-andrews`, `first-pres-anytown`) won't. The `path` column's own comment says it's slated to migrate to a real Postgres `ltree` type, whose labels don't permit hyphens at all — a `path` value copied verbatim from a hyphenated slug would already be wrong today and would break outright once that migration lands. This needs an explicit derivation rule (e.g., replace `-` → `_`), not an assumption that slug and path can share a value.

3. **F16 (derived-group seeding) is named "explicitly not in scope" but its absence is a functional blocker for the stated goal.** `docs/schema-design.md` F16: *"The `officer_terms` trigger writes into the Session group, which must already exist for that org... the trigger must fail loudly... if one is missing."* `scripts/seed-dev.sql` itself hand-inserts `group_types`/`groups` rows per congregation with a comment reading *"Seeding them at org creation is the real fix."* If this ships without seeding Session/Board of Deacons for the new org, fpcw's admin can create the org row through the new UI but **cannot record a single officer term** until someone runs raw SQL by hand — the exact workaround this feature exists to eliminate for org creation itself. Elevating this from "out of scope" to an **Open Question** below rather than overriding the work-log's own scope call.

4. **No `AUDIT_ACTIONS` key exists for org creation.** Confirmed by reading the full `AUDIT_ACTIONS` object in `src/lib/audit.ts` — nothing named `ORG_CREATED` or similar. This is a security-sensitive mutation (creates the entity every other tenant permission and RLS policy roots against) and must call `recordAudit()` with a new key, `resourceType: "organization"`, `resourceId` = the new org's id, following the `ORG_BRAND_SET` precedent in the same directory (F18: carry the target org's id so the tenant can eventually see platform actions against it, even though there's no tenant to see it yet at creation time).

5. **Failure microcopy for DB/network failure** is unaddressed — not unique to this feature, but worth naming per Pass 4 since this is a brand-new write path with no existing precedent to silently inherit.

6. **Mobile (360px)** — low risk (a four-field form), but unverified; must actually be checked in a browser per `CLAUDE.md`'s "Verify in a Browser" invariant, not assumed safe because it's simple.

7. **Two differently-named `status` columns.** `organizations.status` (default `'active'`, not part of this feature's field list) and `organizations.platform_status` (the field this feature does set) are easy to confuse in code review and in the eventual UI copy. Not blocking, but Phase 3/4 should make sure the form label reads "Platform status" and never bare "Status," to avoid an admin thinking they're setting the wrong column.

8. **No length cap on `name`.** The column is unconstrained `text()` — an admin (or a crafted POST) could submit an absurdly long name with nothing stopping it server-side. Low severity (single-admin-only surface, not public-facing input), but worth a sanity cap given it's now a permanent, denormalized, org-tree-public string.

## Out of Scope (confirm with user)

- Self-serve org creation / onboarding requests (P2).
- `ltree` ancestry modeling, parent-org selection UI (`parentId` is not in this feature's field list at all — confirm fpcw is created as a parentless root row, which is schema-legal today since there's no hierarchy-consistency CHECK on `parentId` vs `organization_type`).
- `organization_slug_aliases` (the future fix for a slug that must change).
- Full P2 backbone pipeline generally, per the work-log's own framing — agreed, that's the right cut line for everything except items 1–3 above, which are asked to be explicitly ruled on rather than silently inherited as "P2's problem."

## Open Questions

- **The organization's real name.** The work-log states the name to enter is "presumably 'First Presbyterian Church of Westerville'" — this has not been explicitly confirmed by the user as the exact string to store. Given the slug (`fpcw`) is being locked in forever by this exact feature, and the name, while not immutable, becomes the first-ever board displaying this congregation, confirm the exact legal/preferred name string before Phase 3 treats it as ground truth.
- Does "onboard the first real congregation" require officer/session data entry to work on day one (→ fold in F16's minimal group seed), or is the org row alone sufficient for this ticket (→ explicitly accept that officer terms remain blocked until a manual SQL step or P2)?
- Should the create form warn the admin, inline, that the slug cannot be changed after this screen? Not required by any invariant, but this is literally the first UI ever built for a write that is permanent by design — a one-line warning costs nothing and prevents a support ticket later.

**Handoff:** to `architect` for Phase 2 — directory placement (`/admin/organizations/new` vs. inline dialog on the list page), server/client split, and confirmation that no new dependency is needed. Architect should also weigh in on whether the `RESERVED_SLUGS` list (Gap 1) belongs in `src/lib/permissions.ts`-adjacent shared code or locally in the new action, since it's a value future features (subdomain routing, P5) will need to import too.

---

# Phase 2 — Architectural Review (architect)

Files read to ground this review (beyond what the analyst already read):
`src/lib/db/domain/groups.ts`, `scripts/seed.ts`, `drizzle/0017_*.sql` (the
`memberships_sync_derived_group` trigger), `src/lib/sites.ts` (domain-module
precedent), `src/lib/db/domain/index.ts`, `src/app` top-level route listing.

## Verdict

Approved with suggestions

## Placement

**Directory placement — `/admin/organizations/new`, not an inline dialog.**
`[id]/page.tsx` is already a multi-field, multi-section form-heavy detail
page (Brand/Profile/Site/Service-Times, each its own co-located client
component). No existing "create" dialog anywhere in `(admin)` to match
against (checked users, flags — neither has one). A dialog also fights the
analyst's own Gap: this is the first-ever *permanent* write (immutable
slug) in the app, and a cramped `Dialog` is the wrong affordance for a
screen that should have room for an explicit "this cannot be changed"
warning.

- `src/app/(admin)/admin/organizations/new/page.tsx` — server component,
  auth+feature gate inline (matching existing list/detail pages), renders
  the form.
- `src/app/(admin)/admin/organizations/new/create-organization-form.tsx` —
  `'use client'`, mirrors `BrandForm`'s shape.
- `src/app/(admin)/admin/organizations/new/actions.ts` — new file, not
  appended to `[id]/actions.ts` (that file's every action takes an existing
  `organizationId`; creation is a different resource-lifecycle stage).
- A `Button asChild` "New organization" link added to the existing
  `page.tsx`'s action row.

**Server vs Client split.** Matches `[id]/page.tsx` + `[id]/actions.ts` +
`BrandForm` exactly: server component page (auth/feature check, render);
`'use client'` only on the form itself for controlled inputs and
submit-pending state (reuse whichever of `useTransition`/`useActionState`
`BrandForm` already uses, verified in Phase 4, not invented fresh); `'use
server'` action, same shape as `[id]/actions.ts`. No route handler needed —
every existing write on this surface is a server action.

**Dependencies.** None needed, confirmed against all four of `CLAUDE.md`'s
dependency-evaluation criteria, not assumed. Four native fields using
existing shadcn primitives already generated in `src/components/ui/`; slug
validation reuses the existing `organizations_slug_format` regex
client-and-server-side, same precedent as other regex reuse in
`[id]/actions.ts`.

**`RESERVED_SLUGS` — new file, `src/lib/reserved-slugs.ts`.** Confirmed via
repo-wide grep: does not exist anywhere yet. Does not belong in
`src/lib/db/domain/org.ts` (schema-only by that directory's own stated
convention) or inside the new `actions.ts` (P5's future subdomain routing
will need this too, and an Edge-side consumer shouldn't have to import a
server-action file to get a `Set<string>`). Precedent to copy:
`src/lib/brand/contract.ts` — "zero runtime imports," importable from
anywhere including eventually `src/proxy.ts`.

```
src/lib/reserved-slugs.ts
  export const RESERVED_SLUGS: ReadonlySet<string>
  export function isReservedSlug(slug: string): boolean
```

Seed with infra labels (`www`, `api`, `app`, `admin`, `auth`, `mail`, `ftp`,
`staging`, `dev`) plus presby's current top-level `src/app` route segments
(`launch`, `orgs`, `home`, `account`, `no-organization`, `developer`) —
tech-lead should pull the exact list from the live route tree, not
reconstruct from memory.

**`organizations.path` derivation.** Confirmed via `scripts/seed-dev.sql`:
`path` segments use underscores while `slug` legally contains hyphens
(`organizations_slug_format` permits `[a-z0-9-]`); the column is slated to
migrate to real `ltree`, whose labels reject hyphens outright. Since this
ticket creates only parentless root orgs, the rule Phase 3 must implement:

> `path = slug.replace(/-/g, "_")` — a named, tested function, never an
> inline `.replace()` at the call site and never the slug taken verbatim
> (even though `fpcw` happens to dodge the bug by having no hyphen).

**F16 group-seed placement — same transaction, and it is bigger than
"Session + Board of Deacons."** `[id]/actions.ts`'s own
`setOrganizationBrandAction` establishes the `platformDb.transaction(...)`
precedent. F16's applied trigger (`drizzle/0017`,
`memberships_sync_derived_group`) raises a hard Postgres exception the
first time *anyone* inserts a `memberships` row for the new org, not just
the first officer term — a two-step "org insert, then a follow-up
group-seed action" leaves a real window where the org exists but is
unusable.

Two corrections to what was locked in after Phase 1, found by reading the
actual seed pattern rather than assuming "Session, Board of Deacons" is
complete:

- **A third derived group is required.** `scripts/seed-dev.sql` seeds
  `Session`, `Board of Deacons`, **and** `Active Membership`
  (`derived_from = 'active_membership'`, `group_types.key = 'roster'`) for
  every congregation. Skipping the third group doesn't just block
  officer-term recording — it hard-fails the very first
  directory/membership insert for fpcw.
- **Group seeding must be conditional on `organizationType`.** In the
  fixture, the presbytery org gets *only* `active_membership` — no
  Session, no Board of Deacons (a presbytery has neither in this schema).
  Concrete rule: `if organizationType === 'congregation'`, seed
  `session` + `diaconate` + `active_membership`; otherwise seed
  `active_membership` only. This form permits creating any of the five
  `organization_type` values, so an unconditional "always seed Session +
  Deacons" path would misbehave the day someone creates a presbytery
  through it.

**A separate, more serious gap: the platform-wide `group_types` template
rows (`court`, `roster`) do not exist in any production-reachable seed
path.** `scripts/seed.ts` (what `db:seed` actually runs, described in
`CLAUDE.md` as production-safe) inserts `roles`/`features`/`featureFlags`/
`roleFeatures`/fixture users — **not** `group_types`. The only place
`court`/`committee`/`roster` platform-wide templates
(`organization_id IS NULL`) get created is `scripts/seed-dev.sql`,
explicitly dev-fixture-only by its own header. **The real database this
feature ships against today has no `group_types` row to reference at
all** — `createOrganization()` would find nothing to look up. Phase 3 must
resolve this explicitly:
1. *(recommended)* Add the two platform-wide `group_types` rows to
   `scripts/seed.ts` as an idempotent `onConflictDoNothing()` insert,
   matching how `roles`/`features` are already seeded there — a one-time
   platform bootstrap, run once against the real DB before fpcw's org row
   is created.
2. Have the org-creation transaction find-or-create the `group_types` row
   inline — works, but duplicates seed semantics into a hot mutation path
   and makes every future org-creation call pay a defensive existence
   check for something that should already be static platform config.

**Placement of the group-seed logic.** Not inline in `new/actions.ts`, not
in `src/lib/db/domain/groups.ts` (schema-only). Follow `src/lib/sites.ts`'s
precedent: a plain `src/lib/` module (not under `db/domain/`) owning SQL
correctness, imported by a thin action wrapper. Concretely:
`src/lib/org-provisioning.ts` (name is tech-lead's call) exporting
`createOrganization(input): Promise<Result>` doing the
`platformDb.transaction()` — insert `organizations`, derive `path`, look
up platform-wide `group_types` ids, insert the type-conditional `groups`
rows, return the new org id. `new/actions.ts` becomes a thin
FormData-parsing wrapper, exactly like `provisionSiteAction` wraps
`provisionSite`.

## Invariants Touched

- **Composite Tenant Keys.** `organizations` itself is exempt by design
  (org tree is deliberately public/non-tenant-isolated). It IS in play for
  the `groups` insert (`unique(id, organizationId)`), but this feature
  creates no FK *into* `groups` — respects the invariant by not touching
  it.
- **Isolation Is a Database Property.** No RLS interaction — this write
  path is `getPlatformDb()` throughout, matching every existing
  `[id]/actions.ts` action. An org doesn't exist yet at creation time, so
  there is categorically no membership to verify against it.
- **No Role Carries a Wildcard.** Not implicated — no new role, no new
  grant shape.
- **Permissions vs Flags.** Correctly kept separate: `FEATURES.
  ADMIN_ORGANIZATIONS` (permission, reused), no flag — DECISION-003's
  split test has no rollout shape to cover here.
- **The Court Is Not a Group.** This is *why* Session/Diaconate must be
  materialized rows that exist before any officer term can be recorded —
  this feature is the first write path that must honor that by
  construction, not by a manual SQL follow-up.
- **`(org)` contract — immutable slug, DNS-label CHECK.** The first-ever
  write path for `organizations.slug`. The CHECK constraint is DB-enforced
  (not `paper`) so a malformed slug can't be persisted — but
  `RESERVED_SLUGS` has no constraint backing it and is pure application
  logic the new action must own, making it a `paper` invariant exactly like
  the F16 group-seed check would be if skipped. Single highest-value thing
  Phase 3 gets right or wrong on this ticket.
- No new brandable route group — `/admin/organizations/new` sits inside
  the existing `(admin)` group, already outside the brandable set.

## Notes

Things Phase 3 must honor, not re-litigate:

1. Seed all three derived groups (`session`, `diaconate`,
   `active_membership`), conditional on `organizationType ===
   'congregation'` (non-congregation orgs get `active_membership` only) —
   a correction to the work-log's locked-in scope, not new scope; same F16
   commitment, correctly sized.
2. Resolve the missing platform-wide `group_types` rows (`court`, `roster`)
   before or as part of this ticket — add to `scripts/seed.ts`
   (recommended) or find-or-create inline. Without one of these,
   `createOrganization()` cannot function against the real database this
   feature exists to unblock.
3. `RESERVED_SLUGS` lives in a new zero-import file,
   `src/lib/reserved-slugs.ts`.
4. `path` derivation is `slug.replace(/-/g, "_")`, as a named tested
   function.
5. One `platformDb.transaction()` covering the org insert, `path`
   derivation, and all conditional `groups` inserts — no follow-up step.
6. Group-seed logic (and `createOrganization()` generally) lives in a new
   plain `src/lib/` module (e.g. `src/lib/org-provisioning.ts`), mirroring
   `src/lib/sites.ts`'s shape.
7. New route+files: `.../new/page.tsx`, `.../new/create-organization-
   form.tsx` (`'use client'`), `.../new/actions.ts` (`'use server'`) — a
   dedicated route, not a dialog. "New organization" link added to the
   existing list page.
8. Carry forward the analyst's unresolved items as explicit Phase 3
   decisions, not silent inheritance: `AUDIT_ACTIONS.ORG_CREATED` (Gap 4),
   the `FEATURE_CATALOG` description update for `ADMIN_ORGANIZATIONS`
   (Phase 1 Permissions & Flags note), "Platform status" vs bare "Status"
   labeling (Gap 7), a `name` length cap (Gap 8).
9. No new dependency required — confirmed against all four criteria.

**Handoff:** to `tech-lead` for Phase 3. Treat items 1–6 above as settled
inputs — this review already did the code-reading to rule out the wrong
shortcuts ("two groups," "path = slug," "group_types already exist") that
looked plausible but aren't what the codebase's own trigger and seed
pattern require. Implementer selection is tech-lead's call — this spans a
new DB-transaction-heavy domain module + server action + two client
components; `full-stack-developer` fits "small but coupled," though
splitting schema/logic to `database-admin`/`api-developer` and UI to
`ux-developer` is also reasonable.

---

# Phase 3 — Technical Design (tech-lead)

Files read to ground this design (beyond what Phases 1 and 2 already read):
`src/lib/db/domain/org.ts`, `src/lib/db/domain/groups.ts`, `scripts/seed.ts`,
`scripts/seed-dev.sql` (group_types/groups block, lines 30–88), `src/lib/audit.ts`,
`src/lib/permissions.ts`, `src/app/(admin)/admin/organizations/[id]/actions.ts`,
`src/app/(admin)/admin/organizations/[id]/page.tsx`,
`src/app/(admin)/admin/organizations/[id]/brand-form.tsx`,
`src/app/(admin)/admin/organizations/page.tsx`, `src/lib/sites.ts` (full
`ProvisionSiteResult`/`isUniqueViolation` precedent), `drizzle/0017_*.sql`
(`presby_sync_derived_membership_group`), `e2e/admin-organizations.spec.ts`,
`src/app` route tree (all top-level and route-group-child segments).

## Summary

There is no write path anywhere in presby for `organizations` — every existing
row came from `scripts/seed-dev.sql` or raw SQL. This adds the one missing
primitive: a platform operator can create an org row from
`/admin/organizations/new` with the minimum legal fields (name, slug, type,
platform status), get its `path` derived correctly, and — because F16's derived
groups must exist before the very first `officer_terms` or `memberships` write
against that org — get its `Session`/`Board of Deacons`/`Active Membership`
groups seeded in the same transaction, so the org is immediately usable rather
than blocked on a manual SQL step. This unblocks onboarding the first real
tenant, First Presbyterian Church of Westerville (`fpcw`), which is otherwise
fully staged (site content, brand/profile UI, `presby-site-kit` v3.4.0) with
nowhere to write.

## Permissions & Flags

- **Permission:** reuse `FEATURES.ADMIN_ORGANIZATIONS` (`admin.organizations`)
  — same gate as every other action in `[id]/actions.ts`. No new key.
- **Default role bindings:** unchanged — whatever already holds
  `admin.organizations` (bound to `ADMIN_ROLE` via `bindAdminFeatures()` in
  `scripts/seed.ts`) gets this for free. No new binding to seed.
- **Flag:** not needed, confirmed — DECISION-003's split test finds no
  rollout shape here; this is core admin infrastructure, always-on for
  whoever already holds the permission.
- **`FEATURE_CATALOG` description update** (Phase 1 Gap, carried forward):
  `ADMIN_ORGANIZATIONS`'s description in `src/lib/permissions.ts` currently
  reads "Set a congregation's brand colour, logo and type pairing at
  onboarding; neutralise an abusive tenant's brand." — it no longer scopes
  the permission once it also gates creating the org row itself. New text:
  `"Create organizations; set a congregation's brand colour, logo and type
  pairing at onboarding; neutralise an abusive tenant's brand."` `name` field
  stays `"Manage organization branding"` — renaming it is out of scope here
  (would touch nothing functional, just churns a label admins already know).

## API Contract

No route handlers — matches every existing write on this surface (server
actions only, no route handler precedent to break).

**`src/lib/org-provisioning.ts`** (new plain `src/lib/` module, mirroring
`src/lib/sites.ts`'s shape — SQL correctness lives here, the action wraps it):

```ts
export type CreateOrganizationInput = {
  name: string;
  slug: string;
  organizationType: OrganizationType; // the 5-value pg enum from domain/org.ts
  platformStatus: "managed" | "unmanaged" | "invited";
};

export type CreateOrganizationResult =
  | { kind: "ok"; organizationId: string }
  | { kind: "invalid_input"; error: string }
  | { kind: "slug_taken" }
  | { kind: "reserved_slug" }
  // group_types (`court`, `roster`) platform-wide rows are missing — the
  // `npm run db:seed` prerequisite (Implementation Order step 1) hasn't run
  // against this database yet. Distinct from invalid_input: nothing the
  // admin typed is wrong.
  | { kind: "provisioning_incomplete" };

/** slug.replace(/-/g, "_") — named and unit-tested on its own, never an
 *  inline .replace() at the call site (Phase 2 ruling). */
export function deriveOrgPath(slug: string): string;

export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResult>;
```

`createOrganization()` runs one `platformDb.transaction()`:
1. Look up the two platform-wide `group_types` rows
   (`organization_id IS NULL AND key IN ('court', 'roster')`). If either is
   missing, return `{ kind: "provisioning_incomplete" }` — do NOT create them
   inline (Phase 2's explicit rejection of that shortcut: it duplicates seed
   semantics into a hot mutation path).
2. Insert the `organizations` row: `name`, `slug`, `organizationType`,
   `platformStatus`, `path: deriveOrgPath(slug)`. Catch `23505` (helper
   `isUniqueViolation`, a local copy of `sites.ts`'s own un-exported
   6-line helper — that function isn't exported, and duplicating six lines
   is cheaper than exporting a cross-module utility for one caller) →
   `{ kind: "slug_taken" }`. A pre-insert `SELECT` also runs first so the
   common case gets a clean check rather than relying on the DB exception for
   every request; the catch exists for the TOCTOU gap between the two.
3. Insert `groups` rows, conditional on `organizationType`:
   - `organizationType === "congregation"`: three rows — `Session`
     (`groupTypeId` = court, `derivedFrom: "session"`), `Board of Deacons`
     (`groupTypeId` = court, `derivedFrom: "diaconate"`), `Active Membership`
     (`groupTypeId` = roster, `derivedFrom: "active_membership"`). All three:
     `membershipSource: "derived"`, `isProtected: true` — matches
     `scripts/seed-dev.sql`'s fixture shape exactly (lines 64–88).
   - anything else (`presbytery`, `synod`, `general_assembly`,
     `new_worshiping_community`): `Active Membership` only, same shape. This
     mirrors the fixture's own presbytery row (no Session/Deacons) — a
     presbytery, synod, GA, or NWC has no session in this schema.
4. Return `{ kind: "ok", organizationId }`.

**`src/lib/reserved-slugs.ts`** (new, zero runtime imports, per Phase 2):

```ts
export const RESERVED_SLUGS: ReadonlySet<string>;
export function isReservedSlug(slug: string): boolean;
```

Exact seed list — pulled from the live `src/app` route tree rather than
reconstructed from memory, both bare top-level segments and every route
group's child segments (route groups add no URL segment, so e.g. `(auth)`'s
`signin` is a live top-level path today):

`account`, `admin`, `developer`, `signin`, `totp`, `feedback`, `home`,
`orgs`, `whats-new`, `o`, `forgot-password`, `reset-password`, `site`,
`access-pending`, `api`, `launch`, `no-organization` — plus infra labels not
yet live routes but reserved for P5's `<slug>.presby.app`: `www`, `app`,
`auth`, `mail`, `ftp`, `staging`, `dev`.

**`src/app/(admin)/admin/organizations/new/actions.ts`** (`"use server"`,
new file — not appended to `[id]/actions.ts`, whose every action takes an
existing `organizationId`):

```ts
export type PolicyResult =
  | { ok: true; organizationId: string }
  | { ok: false; error: string };

export async function createOrganizationAction(
  formData: FormData,
): Promise<PolicyResult>;
```

FormData fields: `name`, `slug`, `organizationType`, `platformStatus`.
Responsibilities, in order:
1. `auth()` + `hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)`
   → `{ ok: false, error: "Forbidden." }` on failure (verbatim string,
   matching every other action in `[id]/actions.ts`).
2. Field-shape validation owned HERE (mirrors `setOrganizationBrandAction`'s
   division of labor — the action validates shape, the library validates
   against the database):
   - `name`: trimmed, non-empty, ≤200 chars (Phase 1 Gap 8's cap — see Data
     Model). Empty → `"Enter an organization name."` Over the cap →
     `"That name is too long — keep it under 200 characters."`
   - `slug`: tested against `organizations_slug_format`'s own regex
     (`/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/`), reused verbatim from
     `org.ts`, not re-derived. No auto-lowercasing or auto-slugify — the slug
     is permanent, so what the admin sees in the box is what gets stored, or
     they get told exactly why not. Failure → `"Slugs are lowercase
     letters, numbers, and hyphens only, and must start and end with a
     letter or number (max 63 characters) — for example, fpcw or
     first-pres-anytown."`
   - `organizationType`: must be one of the 5 real enum values. Failure →
     `"Choose a valid organization type."`
   - `platformStatus`: must be one of `managed` / `unmanaged` / `invited`
     (NOT `organizations.status`'s own `active`/inactive values — a
     different column entirely, see Data Model). Failure → `"Choose a valid
     platform status."`
3. Call `isReservedSlug(slug)` → `{ ok: false, error: "That slug is
   reserved for platform use — choose another." }` before ever calling
   `createOrganization()` (cheap, no DB round-trip needed to reject it).
4. Call `createOrganization()`, map its result:
   - `ok` → `recordAudit({ action: AUDIT_ACTIONS.ORG_CREATED, resourceType:
     "organization", resourceId: organizationId, metadata: { name, slug,
     organizationType, platformStatus } })`, `revalidatePath("/admin/organizations")`,
     return `{ ok: true, organizationId }`.
   - `slug_taken` → `{ ok: false, error: "That slug is already taken —
     choose another." }`
   - `reserved_slug` → same reserved-slug copy as step 3 (belt-and-suspenders
     against a race where two admins submit different reserved names — low
     value but free, since the field already returned early above for the
     common case).
   - `provisioning_incomplete` → `{ ok: false, error: "We can't create
     organizations right now — platform setup is incomplete. Contact an
     engineer." }` (not admin-actionable; distinct copy from every other
     failure so it reads as an infra problem, not a typo).
   - `invalid_input` → pass the library's `error` string through unchanged
     (defense-in-depth only; the action's own step 2 should catch everything
     this branch could return).

**No `redirect()` inside the action.** Every other action on this surface
(`setOrganizationBrandAction`, `provisionSiteAction`, etc.) returns `{ ok
}` and revalidates in place, because they all mutate an org the caller is
already looking at. This is the first action that must navigate to a page
that didn't exist before submission. Decision: return `{ ok: true,
organizationId }` and let the client component `router.push()` in a
`useEffect` keyed on the action result — NOT `redirect()` thrown from inside
the server action. Reasoning: `redirect()`'s `NEXT_REDIRECT` throw is
awkward to assert against in a Vitest unit test (the implementer's required
regression coverage for `createOrganizationAction`), and every other action
on this surface already establishes "return a result, let the client
decide" as the house pattern — diverging from it here to save one
`useEffect` is not worth becoming the one exception.

## Data Model

No schema changes required. Every column this feature writes already exists.
Naming them explicitly, since Phase 1 flagged real risk of ambiguity here:

| Table | Column | Set by this feature? | Notes |
|---|---|---|---|
| `organizations` | `name` | yes | `text`, not null. App-layer cap at 200 chars (Phase 1 Gap 8) — **not** a new DB `CHECK`. Unlike `slug`, `name` is not immutable (the `(org)` contract's own text: "Renaming a congregation changes `organizations.name`, never `slug`"), so a DB-level constraint is lower priority than the invariants already backed by CHECKs. If a future review wants a hard floor, that's a `database-admin` migration, not this ticket. |
| `organizations` | `slug` | yes | `text`, unique, `organizations_slug_format` CHECK (DB-enforced, unaffected). Immutable forever — no UPDATE path exists or is added here. |
| `organizations` | `organizationType` | yes | pg enum, 5 values, not null — form is a `<select>` over all 5. |
| `organizations` | `platformStatus` | yes | `text`, default `'unmanaged'` in the schema. **This form's own default is `'managed'`**, not the column default — an admin using this brand-new UI is, in the overwhelming case, onboarding a real tenant (fpcw is exactly that), and `'unmanaged'`/`'invited'` rows are a presbytery-steward scenario this ticket does not otherwise build toward. The dropdown still offers all 3. |
| `organizations` | `path` | yes (derived) | Never a form field. `deriveOrgPath(slug)` = `slug.replace(/-/g, "_")`. |
| `organizations` | `parentId` | **no** | Stays `null` — see Out of Scope below. Schema-legal (nullable, no hierarchy-consistency CHECK). |
| `organizations` | `status` | **no** | Left at its column default (`'active'`). Distinct column from `platformStatus` — Phase 1 Gap 7. The create form's select is labeled **"Platform status,"** never bare "Status," and this table makes the distinction explicit for Phase 4 so the two are never conflated in code review. |
| `group_types` | (read only) | no | `court` and `roster`, `organization_id IS NULL` rows. **Not created by this feature** — see Implementation Order step 1. `committee` is deliberately NOT added in this pass (nothing this feature creates uses it); flagged under Edge Cases as a follow-on gap, not expanded scope here. |
| `groups` | `organizationId`, `groupTypeId`, `name`, `membershipSource`, `derivedFrom`, `isProtected` | yes | 1 or 3 rows per new org, conditional on `organizationType` — see API Contract step 3. |

## Component / Page Plan

**Pages to create:**
- `src/app/(admin)/admin/organizations/new/page.tsx` — server component.
  `auth()` + `hasFeature(..., FEATURES.ADMIN_ORGANIZATIONS)` gate rendered
  inline (matches `page.tsx`/`[id]/page.tsx`'s "You don't have permission to
  manage organization branding." pattern verbatim, not a redirect). Renders
  `<CreateOrganizationForm />`. No data fetch needed — a blank form has
  nothing to hydrate from.

**Components to create:**
- `src/app/(admin)/admin/organizations/new/create-organization-form.tsx` —
  `"use client"`. Mirrors `BrandForm`'s shape: `useActionState` wrapping
  `createOrganizationAction`, inline `getByRole("status")` result banner
  (E-c1/E-c2 precedent — persists, unlike the toast which fires alongside
  it), `useEffect` + `useRouter().push()` on `{ ok: true }` to navigate to
  `/admin/organizations/${organizationId}`.
  - `name`: `Input`, `maxLength={200}`.
  - `slug`: `Input`. **Inline warning directly under the field** (Phase 1
    Open Question, resolved yes): *"This cannot be changed once the
    organization is created."* Plus the DNS-label hint text, shown
    statically (not only on error) since this is the one field on the page
    with permanent consequences.
  - `organizationType`: shadcn `Select`, options = the 5 enum values with
    the same `.replace(/_/g, " ")` human-readable rendering the list page
    already uses (e.g. `new_worshiping_community` → "new worshiping
    community").
  - `platformStatus`: shadcn `Select`, options = `managed` / `unmanaged` /
    `invited`, labeled **"Platform status."** Default `managed`.
  - Submit button: `"Create organization"`, disabled while `isPending`.

**Files to modify:**
- `src/app/(admin)/admin/organizations/page.tsx` — add a `Button asChild`
  linking to `/admin/organizations/new` in the header/action area (next to
  the existing filter buttons), gated behind the same
  `hasFeature(FEATURES.ADMIN_ORGANIZATIONS)` check already wrapping the
  whole page — no separate gate needed since the unauthorized branch returns
  before this JSX is reached.
- `src/lib/permissions.ts` — `FEATURE_CATALOG` description update (see
  Permissions & Flags).
- `src/lib/audit.ts` — add `ORG_CREATED: "org.created"` to `AUDIT_ACTIONS`,
  with a comment following the `ORG_BRAND_SET`/F18 precedent (a platform
  action against a tenant carries that tenant's id as `resourceId`).
- `scripts/seed.ts` — add `seedGroupTypes()` (see Implementation Order #1).

## Implementation Order

1. **`scripts/seed.ts`: add `seedGroupTypes()`.** Confirmed by reading both
   `scripts/seed.ts` (what `db:seed` actually runs against a real database —
   no `group_types` insert exists today) and `scripts/seed-dev.sql` (dev-only
   fixture, the sole place these rows exist anywhere reachable). Insert, with
   `.onConflictDoNothing()` matching the existing `roles`/`features` pattern
   in the same file:
   ```ts
   { organizationId: null, key: "court", name: "Court" },
   { organizationId: null, key: "roster", name: "Roster" },
   ```
   Call it from `main()` alongside `seedRoles()`/`seedFeatures()`. **This
   must be run (`npm run db:seed`) against the real target database before
   `createOrganization()` can succeed there** — call this out explicitly at
   handoff; it is a one-time platform bootstrap, not part of every deploy.
2. `src/lib/reserved-slugs.ts` — `RESERVED_SLUGS`, `isReservedSlug()`.
3. `src/lib/org-provisioning.ts` — `deriveOrgPath()`, `createOrganization()`.
   Unit tests here first (Vitest, DB-backed, `describe.skipIf(!hasDb)`
   pattern per `src/lib/sites.test.ts`) — this is the highest-value module to
   get right before anything calls it.
4. `src/lib/permissions.ts` — `FEATURE_CATALOG` description update.
5. `src/lib/audit.ts` — `AUDIT_ACTIONS.ORG_CREATED`.
6. `src/app/(admin)/admin/organizations/new/actions.ts` —
   `createOrganizationAction()`.
7. `src/app/(admin)/admin/organizations/new/page.tsx` +
   `create-organization-form.tsx`.
8. `src/app/(admin)/admin/organizations/page.tsx` — "New organization" link.
9. Regression tests (implementer-authored, QA verifies): `deriveOrgPath()`
   unit cases (hyphen replacement, no-hyphen passthrough), `isReservedSlug()`
   cases, `createOrganization()`'s branch coverage (ok/slug_taken/
   reserved_slug — reachable at this layer even though the action also
   checks it/provisioning_incomplete, and the congregation-vs-other group
   count), plus one new e2e test in `e2e/admin-organizations.spec.ts` or a
   sibling file covering the create-then-land-on-detail-page happy path and
   the duplicate-slug inline error. **Verify the form in a browser at a
   360px viewport** (Phase 1 Gap 6 / CLAUDE.md "Verify in a Browser") — not
   assumed safe because it's a four-field form.
10. Release notes entry — **tech-lead's job at Phase 6 SHIP IT**, not the
    implementer's. Same for `docs/product/functionality-map.md` (Rule 14)
    and `docs/TODO.md` reconciliation (Rule 10) — flagged here so they aren't
    dropped, not assigned to Phase 4.

## Edge Cases & Risks

- **`group_types` bootstrap ordering.** `createOrganization()` fails closed
  (`provisioning_incomplete`, not an unhandled FK violation) if `court`/
  `roster` are missing — but the real database this feature exists to unblock
  has neither row until `npm run db:seed` is re-run with step 1's addition.
  This is a **deploy-time prerequisite**, not a code risk, but it is the one
  most likely to bite on fpcw's actual creation if skipped. Name it in the
  handoff.
- **Reserved-slug list is `paper`, not `database`** (architect's own
  labeling, Invariants Touched). No CHECK constraint backs `RESERVED_SLUGS` —
  it is pure application logic in the one place that currently writes a
  slug. A future second write path (there is only one today) must remember
  to call `isReservedSlug()` too; nothing enforces that at the schema level.
- **`committee` group_type remains unseeded.** Architect's ruling scoped the
  `scripts/seed.ts` addition to exactly `court`+`roster` — the two types this
  feature's own group-seeding needs. `committee` (used by
  `scripts/seed-dev.sql`'s "Property Committee" example) stays absent from
  any production-reachable seed path. Not a blocker: no UI exists yet to
  create a `committee`-type group at all (managed groups have no admin
  surface today), so nothing in presby currently needs that row. Flagged as
  a known gap for whoever builds group management, not silently dropped.
- **Non-congregation org types get only `Active Membership`.** Confirmed
  against `scripts/seed-dev.sql`'s own presbytery fixture (no Session, no
  Board of Deacons). `new_worshiping_community` gets the same treatment as
  presbytery/synod/GA under this ticket's rule, purely because the fixture
  gives no evidence an NWC needs a session — if that turns out wrong, it's a
  narrow follow-up to the conditional in `createOrganization()`, not a design
  reversal.
- **Race on slug uniqueness.** Pre-insert `SELECT` plus a caught `23505` on
  the actual insert (TOCTOU gap between the two) — same shape
  `provisionSite()` already uses for `organization_sites_repo_unique`.
- **DB/network failure mid-transaction.** Surfaces as a generic "we
  couldn't create that organization right now — try again in a moment,"
  never a raw exception or stack trace (Phase 1 Gap 5) — this is the
  fallback branch in `createOrganizationAction`'s try/catch around the
  `createOrganization()` call, distinct from every named `kind`.
- **Unauthorized.** Two layers: the page's inline gate (can't reach the
  form) and the action's own `"Forbidden."` (defense-in-depth against a
  crafted POST), matching the verbatim string every other action on this
  surface already returns.
- **e2e blast radius.** `e2e/admin-organizations.spec.ts` Test 2 ("admin
  reaches the organizations list…", the OQ4 filter test) reads
  `page.getByText(ALPHA_ORG_NAME)` and a sidebar link with `name:
  "Organizations"` — the new "New organization" link uses different text
  and sits in the header action row alongside the existing filter buttons;
  read closely, it does not collide with either assertion, but the
  implementer must run this spec (not just the new one) after landing step 8,
  since it is the one existing spec whose DOM neighborhood this change
  touches. No other existing spec references `/admin/organizations`.
- **Mobile 360px.** Four fields + two selects, low complexity but unverified
  until checked in a real browser per the project's own invariant — three
  prior bugs in this codebase were phone-only and invisible to `next build`.

## Out of Scope (confirmed)

- **Parent-org selection.** This ticket creates **root organizations only**
  — `parentId` is not a field on the form and is never set (stays `null`).
  Schema-legal today (no hierarchy-consistency CHECK on `parentId` vs
  `organizationType`). fpcw itself is created this way — no presbytery is
  modeled above it yet. Full `ltree` ancestry modeling and a parent-picker UI
  are explicitly P2's problem, not this ticket's.
- Self-serve org creation / onboarding requests (P2).
- `organization_slug_aliases` (the future fix for a slug that must change).
- Renaming `ADMIN_ORGANIZATIONS`'s `name` field in `FEATURE_CATALOG` (only
  its `description` changes here).

## Implementer

**full-stack-developer.** The work spans one new DB-transaction-heavy domain
module (`org-provisioning.ts`), a `scripts/seed.ts` addition, a server
action, and two small client-facing pieces (a form + a list-page link) — per
CLAUDE.md's selection table, "spans server + client and is small" fits
`full-stack-developer` better than a three-way split across
`database-admin`/`api-developer`/`ux-developer`, which would add handoff
overhead across ~9 total files for a feature this size. No schema migration
is involved (Data Model: "No schema changes required"), so there is no
`database-admin`-specific step to carve out.

---

# Phase 4 — Implementation

**Date:** 2026-08-24
**Implementer:** full-stack-developer

Implemented per the Phase 3 design (files, function signatures, error
copy, transaction shape all match). Two real deviations found and fixed
during implementation, both because Phase 3's design was written before
running the code against a real database — see Implementer Notes below.

## Files Created

- `src/lib/reserved-slugs.ts` — `RESERVED_SLUGS` (Set), `isReservedSlug()`. Zero runtime imports, per Phase 2.
- `src/lib/org-provisioning.ts` — `deriveOrgPath()`, `createOrganization()`. The one write path for `organizations`; owns the `group_types` bootstrap check, path derivation, conditional F16 group seed (Session/Board of Deacons/Active Membership for `congregation`, Active Membership only otherwise), the slug-uniqueness pre-check + `23505` catch, and (see Implementer Notes) its own `isReservedSlug()` defense-in-depth check so the `reserved_slug` result variant is actually reachable at this layer.
- `src/lib/org-provisioning.test.ts` — DB-backed integration tests (`describe.skipIf(!hasDb)`, dynamic imports in `beforeAll`, mirrors `sites.test.ts`'s harness): `deriveOrgPath()` (hyphen replacement, no-hyphen passthrough), `createOrganization()` for a congregation (3 groups, correct `derivedFrom`/`membershipSource`/`isProtected`), for a presbytery (1 group), duplicate-slug rejection, reserved-slug rejection with no row created. 7 tests, run against the real dev DB — all pass.
- `src/lib/reserved-slugs.test.ts` — pure unit tests: live route segments rejected, P5 infra labels rejected, case-insensitivity, an ordinary slug accepted, no empty/whitespace entries in the set.
- `src/app/(admin)/admin/organizations/new/actions.ts` — `createOrganizationAction()`. FormData parsing, field-shape validation (name/slug/type/status), the cheap pre-`isReservedSlug()` check, calls `createOrganization()`, maps every result kind to the Phase 3 copy, `recordAudit(ORG_CREATED)`, `revalidatePath`. No `redirect()` — returns `{ ok, organizationId }` per Phase 3's explicit ruling.
- `src/app/(admin)/admin/organizations/new/actions.test.ts` — mocked unit tests (mirrors `[id]/actions.test.ts`'s harness: `@/auth`, `next/cache`, `@/lib/audit`, and `@/lib/org-provisioning` mocked; `@/lib/reserved-slugs` used for real). Covers both authorization branches, every field-validation error, the reserved-slug short-circuit, and all five `createOrganization()` result-kind mappings (`ok`/`slug_taken`/`reserved_slug`/`provisioning_incomplete`/`invalid_input`) plus the thrown-exception → generic-message path. 18 tests, all pass.
- `src/app/(admin)/admin/organizations/new/page.tsx` — server component. Inline auth/feature gate matching `page.tsx`/`[id]/page.tsx`'s verbatim copy; renders `<CreateOrganizationForm />`.
- `src/app/(admin)/admin/organizations/new/create-organization-form.tsx` — `"use client"`. `useActionState` + `useRouter().push()` in a `useEffect` on `{ ok: true }` (not `redirect()`, per design). Inline `role="status"` error banner + a `toast` supplement, matching `BrandForm`'s pattern. Four fields: `name` (maxLength 200), `slug` (with the static "cannot be changed" warning + DNS-label hint), `organizationType` (native `<select>`, default `congregation`), `platformStatus` (native `<select>`, default `managed`, labeled "Platform status").
- `e2e/admin-organizations-create.spec.ts` — new sibling spec (not appended to `admin-organizations.spec.ts`, whose own fixture org never gets created/deleted by any existing test — this file's whole point is create/delete lifecycle). 5 tests, all passed against a real dev server: member blocked by the Edge proxy; admin creates a congregation and lands on `/admin/organizations/<id>`, with the F16 groups (`Session`, `Board of Deacons`, `Active Membership`) confirmed by direct query; duplicate-slug inline error with no navigation; reserved-slug inline error; a 360px-viewport pass confirming every field/button is visible with no horizontal overflow. Every test cleans up its own `organizations` row via the platform connection — confirmed zero residue after the run.

## Files Modified

- `src/app/(admin)/admin/organizations/page.tsx` — added a "New organization" `Button asChild` link to `/admin/organizations/new` in the header action row (re-flowed the existing filter buttons into their own flex group so the new button sits at the row's trailing edge). Ran `e2e/admin-organizations.spec.ts` (all 9 tests, including Test 2's OQ4 filter assertions) after this change per the design's own instruction — no collision, all pass.
- `src/lib/audit.ts` — added `ORG_CREATED: "org.created"` to `AUDIT_ACTIONS`, with the F18 comment (platform action against a tenant carries that tenant's id as `resourceId`).
- `src/lib/audit.test.ts` — added `ORG_CREATED` to the `EXPECTED_ENTRIES` regression catalog (this test enumerates every `AUDIT_ACTIONS` key exhaustively; it fails on typecheck alone if a new key is added without updating it — caught immediately by `npm run typecheck`).
- `src/lib/permissions.ts` — `FEATURE_CATALOG`'s `ADMIN_ORGANIZATIONS` description updated to lead with "Create organizations; ..." (unchanged `name` field, per Phase 3's explicit scoping).
- `scripts/seed.ts` — added `seedGroupTypes()` (see Implementer Notes for why it needed its own RLS-bypassing connection, a real deviation from the design's literal `.onConflictDoNothing()` suggestion), called from `main()` after `seedFlags()`.

## Schema Changes

None — every column this feature writes already exists (`organizations.name/slug/organization_type/platform_status/path`, `groups.*`). No `db:push` or `db:generate` needed. Confirmed by running `npm run typecheck` and the full Drizzle-typed insert paths against the real dev DB with no schema drift.

## Audit Events

- `AUDIT_ACTIONS.ORG_CREATED` (`"org.created"`) — written by `createOrganizationAction()` on a successful create. `resourceType: "organization"`, `resourceId`: the new org's id, `metadata: { name, slug, organizationType, platformStatus }`. Verified by a unit test asserting the exact `recordAudit()` call shape (`new/actions.test.ts`, "maps ok: audits ORG_CREATED...").

## Implementer Notes

**Two real deviations from the Phase 3 design, both found by running the code, not by re-reading the design doc:**

1. **`scripts/seed.ts`'s `seedGroupTypes()` cannot use the plain `db` connection the rest of that file uses.** Running `npm run db:seed` after the first pass failed with `new row violates row-level security policy for table "group_types"`. Root cause: `group_types` is a `FORCE ROW LEVEL SECURITY` tenant table (`drizzle/0009_presby_rls.sql`) whose `tenant_isolation` policy is `organization_id = presby_current_org()`. A platform-wide template row has `organization_id IS NULL`, and NULL never equals anything under standard SQL equality — not even a matching org context could satisfy that policy for a null-org-id row. `db` in `scripts/seed.ts` connects as `presby_app` (the `DATABASE_URL` role, same NOBYPASSRLS role the app's tenant connection uses) — it can never write this row. Fixed by adding a second connection in `scripts/seed.ts` built from `PLATFORM_DATABASE_URL` (mirroring `getPlatformDb()`'s role in the app runtime) and using it for both the read and the write in `seedGroupTypes()`. Confirmed against the real dev database: first run inserted 2 rows and printed `seeded 2 platform-wide group_types`; two subsequent runs left the row count unchanged (verified by direct query grouping `group_types` by `key` where `organization_id is null`) — idempotent as designed.

2. **`.onConflictDoNothing()` (the design's literal suggestion for `seedGroupTypes()`, "matching the roles/features pattern elsewhere in this file") does not actually make the insert idempotent for `group_types`.** `group_types` has no unique constraint on `(organization_id, key)` — only a non-unique index (`group_types_org_idx`). Its only unique column is `id`, which is always a fresh `defaultRandom()` UUID, so `ON CONFLICT DO NOTHING` never has a constraint to fire against and a re-run would insert a second `court`/`roster` row every time. Caught before it shipped by reading the table's own constraint list rather than trusting the `roles`/`features` precedent (those two DO have real unique columns the pattern needs). Replaced with an explicit find-or-create (select first, insert only if absent). **This is not hypothetical** — while verifying this feature I ran the existing `sites.test.ts` suite against the real dev DB (dotenv-connected `vitest run`), and its own `beforeAll` uses this exact same `.onConflictDoNothing()` pattern for a `group_types` "roster" row; the shared dev database now carries **82 duplicate `organization_id IS NULL, key='roster'` rows** accumulated from repeated test runs over time. Harmless functionally (`createOrganization()` just picks the first match, and any one of them is a semantically-identical template row), but it is real hygiene debt in a shared database. Out of scope to fix here (not this feature's file), flagged to `docs/TODO.md` as a `sites.test.ts` cleanup follow-up rather than silently left for the next person to rediscover.

**One design-completeness fix, not a deviation:** Phase 3's `CreateOrganizationResult` type includes a `reserved_slug` variant and the action's own step 4 describes mapping it as "belt-and-suspenders against a race" — but the Phase 3 API Contract's numbered step list for `createOrganization()` itself (steps 1–4) never actually has it check `isReservedSlug()`, which would make that branch dead code, unreachable at the `createOrganization()` layer, contradicting the type signature that commits to producing it. Added the check inside `createOrganization()` itself (before the `group_types` lookup, so it costs nothing when it fires) — this also directly satisfies Phase 3's own Edge Cases note that "a future second write path must remember to call `isReservedSlug()` too": owning the check inside the one write path itself means a future second path gets it automatically rather than by remembering. Covered by both the DB-backed integration test ("rejects a reserved slug without creating a row") and the e2e spec.

**One deliberate divergence from Phase 3's literal component-plan wording, matching house convention instead:** Phase 3's Component Plan says `organizationType`/`platformStatus` are "shadcn `Select`" — but `src/components/ui/` has no `Select` primitive generated (confirmed by listing the directory), and `docs/ui-standards.md`'s own "Select & Combobox Patterns" section is explicit: *"There is no Popover, Command, or Select primitive in src/components/ui/ today... Don't hand-roll a substitute in the meantime; wait for the primitive and cite the pipeline that generated it."* Generating one via `npm run ui:add -- select` would pull in `@radix-ui/react-select`, a new dependency requiring the architect's five-criteria pass — which Phase 2 explicitly did NOT do (Phase 2's own "Dependencies" section says "None needed... existing shadcn primitives already generated," which was true when written but doesn't hold for a literal `Select`). Used native `<select>` styled with `border-input` instead, matching both the house doc's prescribed pattern and `BrandForm`'s own precedent (which made the identical call for its `typePairing` field, with an inline comment explaining why). This is the lower-risk reading of "no new dependency needed" (Phase 2's own ruling) than generating one the design doc merely assumed existed.

**Minor improvement over the literal design, not a deviation:** the design said to reuse the list page's `organizationType.replace(/_/g, " ")` inline rendering for the type `<select>`'s option labels. Used the existing `organizationTypeLabel()` from `src/lib/org-display.ts` instead (title-cased, PC(USA)-correct polity terms — "New Worshiping Community" rather than "new worshiping community") — that function already exists for exactly this purpose ("Deliberately in one place rather than inline at each render site... three copies of a five-way switch is how a presbytery becomes 'Presbytery' on one page and 'presbytery' on the next," per its own header), so reusing it is strictly better than adding a third inline copy of the same switch.

**Verification run, in order:** `npm run typecheck` (clean), `npm run check` (all four tripwires pass), `npm test` (1720 passed, 141 skipped — the DB-backed suites skip without `DATABASE_URL`, as designed), `npm run db:seed` run twice against the real dev DB with `group_types` row counts confirmed stable via direct query, `src/lib/org-provisioning.test.ts` run with `dotenv -e .env.local` (7/7 pass against the real dev DB), `e2e/admin-organizations.spec.ts` (all 9, including Test 2/OQ4) and the new `e2e/admin-organizations-create.spec.ts` (5/5, including the 360px pass) both run against a real dev server via Playwright, `npm run build` (production build succeeds; `/admin/organizations/new` appears as its own dynamic route, confirming Next's static-segment-over-dynamic-segment precedence resolves correctly against the existing `[id]` route). Did **not** create the real fpcw org — every test uses synthetic `e2e-org-create-*`/`org-prov-test-*`-prefixed fixture data, cleaned up after itself; that creation is the orchestrator's own next step through the real UI.

One pre-existing, unrelated failure observed only when running the full unit suite with a real DB connection (`dotenv -e .env.local -- npx vitest run`, not `npm test`): `src/lib/rate-limit.test.ts` has 3 failing tests. Confirmed pre-existing and out of scope — `git status` shows that file untouched by this work, and the failures reproduce in isolation with no other test files loaded.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-24
**Verified by:** qa

Re-ran everything independently rather than trusting Phase 4's reported
numbers, per this role's charter.

## Type Check

`npm run typecheck`: **PASS** — clean, zero errors.

## Unit Tests

`npm test` (no DB env, matches CI): Total: 1861 | Passed: 1720 | Failed: 0 |
Skipped: 141 | Duration: 3.45s — matches Phase 4's reported 1720/141 exactly.

`dotenv -e .env.local -- npx vitest run` (full suite, DB env loaded, all
DB-backed suites execute): Total: 1861 | Passed: 1858 | Failed: 3 |
Duration: 17.59s. Failures — all in `src/lib/rate-limit.test.ts`, confirmed
**pre-existing and unrelated to this diff** (`git status` shows the file
untouched; root cause is `RATE_LIMIT_DISABLED=true` in `.env.local`
short-circuiting `checkRateLimit()` at `src/lib/rate-limit.ts:190`):
`rate-limit.test.ts:241`, `:256`, `:279`.

DB-backed tests for this feature, run individually with
`dotenv -e .env.local -- npx vitest run <file> --reporter=verbose`:
- `src/lib/org-provisioning.test.ts` — 7/7 pass, against the real dev DB.
- `src/app/(admin)/admin/organizations/new/actions.test.ts` — **20/20
  pass** (Phase 4 reported "18 tests" — an undercount in Phase 4's own
  notes; actual, independently-verified count is 20 — more coverage
  exists than claimed, not less).
- `src/lib/reserved-slugs.test.ts` — 5/5 pass, cross-checked the seed list
  against the live route tree (`find src/app -maxdepth 2 -type d`)
  independently — every live top-level segment is present in
  `RESERVED_SLUGS`.

## End-to-End Tests

Ran against a real, already-running dev server on `:3000` (verified with
`curl` before running Playwright, not started fresh).

`npx playwright test e2e/admin-organizations-create.spec.ts
e2e/admin-organizations.spec.ts --reporter=list`: Total: 14 | Passed: 14 |
Failed: 0 | Skipped: 0 | Duration: 24.5s

- `e2e/admin-organizations-create.spec.ts` — 5/5 (member blocked by proxy;
  admin creates a congregation and lands on `/admin/organizations/<id>`,
  F16 groups confirmed by direct query; duplicate-slug inline error, no
  navigation; reserved-slug inline error; 360px viewport pass with a
  no-horizontal-overflow assertion). Matches Phase 4's reported 5/5.
- `e2e/admin-organizations.spec.ts` — 9/9, including Test 2's OQ4 filter
  assertions — confirms the new "New organization" button does not
  collide with existing DOM assertions, as Phase 4 claimed.
- **Residue check (independent):** queried the real DB directly after the
  run — `select slug, created_at from organizations where slug like
  'e2e-org-create-%'` returned **0 rows**. Confirms the spec's `finally`
  blocks actually clean up.

## `db:seed` idempotency (independently re-verified)

Ran `npm run db:seed` a third time (Phase 4 reported two runs already).
Read `scripts/seed.ts:219-242`'s `seedGroupTypes()` directly — genuine
find-or-create (SELECT on `(organization_id IS NULL, key)` via
`platformDb`, INSERT only if absent), not the design's originally-suggested
`.onConflictDoNothing()`. Queried the DB directly before/after this third
run: `court` (the group_type this feature's own seeding depends on) stayed
at exactly **1 row**, confirming genuine idempotency. `roster`'s elevated
count is a pre-existing, unrelated `sites.test.ts` bug (already flagged to
`docs/TODO.md` by Phase 4) — not caused by `seedGroupTypes()`, confirmed by
the count not moving on this third `db:seed` run itself.

## Regression Tests Added

- `src/lib/org-provisioning.test.ts` — DB-backed, real dev DB:
  `deriveOrgPath()` hyphen/no-hyphen/mixed cases; `createOrganization()`
  for congregation (3 groups, correct `derivedFrom`/`membershipSource`/
  `isProtected`) and presbytery (1 group); slug-taken rejection;
  reserved-slug rejection with no row created. No self-agreeing mock —
  asserts against real Drizzle-typed selects on the real schema.
- `src/lib/reserved-slugs.test.ts` — pure unit: live-route rejection, P5
  infra-label rejection, case-insensitivity, ordinary-slug acceptance, no
  blank entries.
- `src/app/(admin)/admin/organizations/new/actions.test.ts` — mocked unit
  (appropriately, since DB truth is independently covered by
  `org-provisioning.test.ts`): both authorization branches, every
  field-validation error, the reserved-slug short-circuit, all five
  `createOrganization()` result-kind mappings, and the
  thrown-exception → generic-message path.
- `e2e/admin-organizations-create.spec.ts` — full-stack happy path plus
  duplicate-slug and reserved-slug failure paths, plus a 360px viewport
  check.

**Named gaps — not blocking:**
- No automated regression test guards `scripts/seed.ts`'s
  `seedGroupTypes()` idempotency itself — the specific fix for the second
  of the two real bugs Phase 4 documents. `scripts/seed.ts` has zero
  pre-existing test coverage anywhere in this repo, and this wasn't part
  of Phase 3's own listed regression-test scope — not a regression
  specific to this feature's conventions, but a future "simplification"
  back to `.onConflictDoNothing()` would ship silently. Independently
  re-verified the actual behavior against the real DB (three separate
  `db:seed` runs, stable `court` count) rather than trusting Phase 4's
  claim. Recommend a follow-up ticket to extract `seedGroupTypes()` into
  something importable by a DB-backed vitest spec.
- `createOrganization()`'s `provisioning_incomplete` branch
  (`src/lib/org-provisioning.ts:145`) is exercised only at the mocked
  action-layer, never for real against a DB actually missing the
  `court`/`roster` templates. Low risk (now guaranteed by
  `seedGroupTypes()`'s own idempotent bootstrap), named for completeness.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: 100%
- `src/lib/two-factor.ts`: 91.3% stmts / 100% branch / 90% funcs / 90.47%
  lines — meets the 90%+ target. Uncovered: `:35-39` (the `catch` branch
  of `isTotpConfigured()`), pre-existing, untouched by this diff.
- `src/lib/flags.ts`: 100%
- `src/lib/org-provisioning.ts` (new): 84.37% stmts / 56.25% branch /
  87.5% funcs — below the general 70%+ branch bar; uncovered lines 64,
  145, 194-195 (the `isUniqueViolation` false-path, the real
  `provisioning_incomplete` path, and the TOCTOU-race catch branch — all
  named above).
- `src/lib/reserved-slugs.ts` (new): 100%.

## Feature-Gate Audit

Verified by reading the route and action bodies directly, not inferred
from green tests.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `src/app/(admin)/admin/organizations/new/page.tsx` (server component) | yes (`:19`) | yes (`:20`) | `FEATURES.ADMIN_ORGANIZATIONS` — correct |
| `createOrganizationAction` — `new/actions.ts` | yes (`:76`, returns `Unauthorized.`) | yes (`:78`, returns `Forbidden.`) | `FEATURES.ADMIN_ORGANIZATIONS` — correct |
| `src/app/(admin)/admin/organizations/page.tsx` (list page, modified) | yes (pre-existing) | yes (pre-existing, `:52`) — the gate returns before the new link's JSX, so it inherits it with no separate check needed | `FEATURES.ADMIN_ORGANIZATIONS` — correct |
| `src/lib/org-provisioning.ts` `createOrganization()` (library function) | n/a — trusts the caller for authz, correctly (matches every other `getPlatformDb()`-based library); does its own `isReservedSlug()` defense-in-depth, independent of auth | n/a | n/a |

No route handlers were added (server actions only, matching every existing
write on this surface) — confirmed by directory listing.

`RESERVED_SLUGS` cross-checked against the live route tree directly —
accurate, no missing live segment.

`npm run check:audit` ran clean, and independently confirmed
`createOrganizationAction` calls `recordAudit({ action:
AUDIT_ACTIONS.ORG_CREATED, ... })` at `new/actions.ts:156-166`, with
`resourceType: "organization"` and `resourceId` set to the new org's id —
matches the F18 precedent. `AUDIT_ACTIONS.ORG_CREATED` is present in
`audit.test.ts`'s exhaustive `EXPECTED_ENTRIES` catalog (`:126`).

No `console.log`/`console.debug`, no `alert`/`confirm`/`prompt` in any new
file.

`docs/TODO.md:35` confirmed to carry the `sites.test.ts` `group_types`
duplication follow-up, as Phase 4 claimed.

`npm run build` succeeds; `/admin/organizations/new` appears as its own
dynamic route alongside the pre-existing `/admin/organizations/[id]`,
confirming no static/dynamic route collision.

## Verdict

**PASS**

Not an auth-touching diff (`src/auth.ts`, `(auth)/`, `api/auth/`,
`lib/auth/` untouched — confirmed by `git status`), so the stricter auth
e2e gate does not apply. All required checks are green and were
independently re-run: typecheck clean, all four `check:*` tripwires clean,
full unit suite matches Phase 4's reported counts exactly (the 3
`rate-limit.test.ts` DB-env-mode failures confirmed pre-existing and
unrelated), the three DB-backed test files for this feature pass against a
real dev DB (32 tests total, one file undercounted by Phase 4 at 18 vs.
actual 20 — harmless), both e2e specs pass 14/14 against a real running
dev server with zero DB residue confirmed by direct query, `db:seed`
idempotency independently re-verified via a third run plus a direct DB
query, and the feature-gate audit confirms correct `auth()` +
`hasFeature(FEATURES.ADMIN_ORGANIZATIONS)` gating in both the new page and
the new server action by reading the code directly.

Two non-blocking gaps are named above for the record (no automated
idempotency regression test for `scripts/seed.ts`'s `seedGroupTypes()`;
`createOrganization()`'s `provisioning_incomplete` branch untested against
a real DB) — recommend Phase 6 note them as follow-ups rather than
silently closing them.

**Handoff:** to `analyst` for Phase 6 (Shipped vs Intent).

---

# Phase 6 — Shipped vs Intent (analyst)

Files read beyond the full work-log (all six prior phases):
`src/app/(admin)/admin/organizations/new/page.tsx`,
`create-organization-form.tsx`, `actions.ts`, `src/lib/org-provisioning.ts`,
`src/lib/reserved-slugs.ts`, `e2e/admin-organizations-create.spec.ts`,
`src/app/(admin)/admin/organizations/[id]/actions.ts` (precedent
comparison), `src/lib/audit.ts`/`audit.test.ts`, `src/lib/permissions.ts`
(`FEATURE_CATALOG`), `docs/TODO.md`, `docs/product/functionality-map.md`,
`docs/STATE.md`, `git status`/`git log`.

## VERDICT

SHIP WITH NOTES

## ONE-LINE TAKE

> The one missing write path for `organizations` shipped exactly as designed — immutable-slug warning, reserved-slug list, F16 group seeding, per-branch error copy, and a real 360px pass are all present in the actual code, not just claimed in phase summaries — and it earns its "SHIP WITH NOTES" only on process housekeeping (functionality-map/release-notes/TODO not yet reconciled into this still-uncommitted diff) plus one genuinely worth tracking test gap, not on anything wrong with the feature itself.

## What's Working

- **The immutable-slug warning is real, not just claimed.** `create-organization-form.tsx:91-96` renders "This cannot be changed once the organization is created." directly under the slug field, in amber, `aria-describedby`-linked, shown statically (not only on error) — exactly what Phase 1's Open Question asked for and Phase 3 committed to.
- **Every failure mode has its own specific copy**, verified by reading `new/actions.ts` line-by-line against Phase 3's table: empty name → "Enter an organization name."; over-cap name → "That name is too long — keep it under 200 characters."; malformed slug → the full DNS-label explanation with two concrete examples; reserved slug → "That slug is reserved for platform use — choose another." (checked twice — cheap pre-check in the action, defense-in-depth inside `createOrganization()` itself); taken slug → "That slug is already taken — choose another."; missing `group_types` bootstrap → an infra-flavored message distinct from every admin-actionable error ("Contact an engineer."); unauthenticated/unauthorized → "Unauthorized."/"Forbidden.", byte-identical to the six other actions in `[id]/actions.ts`. Nowhere does a raw Postgres error or stack trace reach the user.
- **"Platform status" is never bare "Status,"** confirmed in the rendered label (`create-organization-form.tsx:121`) — resolves Phase 1 Gap 7 directly.
- **F16 group seeding is in the same transaction, type-conditional, and independently proven against a real database twice** — once by `org-provisioning.test.ts` (unit/integration), once by the e2e spec's own direct SQL query confirming `Session`/`Board of Deacons`/`Active Membership` exist for a congregation immediately after creation, before any officer-term UI ever touches it. This was the single highest-stakes open question from Phase 1 (Gap 3) and it shipped correctly, including the presbytery-only-gets-`Active Membership` branch the architect caught in Phase 2 review, not the analyst's original "two groups" undercount.
- **Two real deviations from the design were caught by running the code against a real database, not by re-reading the doc**, and both are documented honestly rather than swept in: the RLS-forced-`FORCE`-on-`group_types` connection problem, and `.onConflictDoNothing()` silently failing to be idempotent because `group_types` has no unique constraint on `(organization_id, key)`. The second one is not hypothetical — it's the same bug already live in `sites.test.ts` (82 duplicate rows in the shared dev DB), and the implementer both fixed it here and pushed the discovery to `docs/TODO.md` rather than treating it as someone else's problem.
- **The reserved-slug list is accurate against the live route tree** — re-derived independently (`find src/app -maxdepth 2 -type d`) and every live top-level segment is present in `RESERVED_SLUGS`, matching QA's independent cross-check.
- **Mobile 360px isn't a claim, it's a real Playwright assertion** (`admin-organizations-create.spec.ts:162-189`) checking every field's visibility plus `scrollWidth > clientWidth` for horizontal overflow — the exact failure mode CLAUDE.md's "Verify in a Browser" invariant exists to catch, and it's automated, not a one-time manual check that bit-rots.

## Intent-vs-Shipped Diff

- Phase 1 said: reuse `FEATURES.ADMIN_ORGANIZATIONS`, no flag. Shipped: exactly that, both layers (page + action) gated. **Matches.**
- Phase 1 said: reserved-slug collision has no list and needs one (Gap 1). Shipped: `src/lib/reserved-slugs.ts`, zero-import, checked at both the action layer (cheap) and the library layer (defense-in-depth — a layer Phase 3's own numbered steps forgot to actually call, caught and fixed by the implementer). **Matches, and closes a hole Phase 3 left open.**
- Phase 1 said: `path` derivation needs an explicit rule, not slug-taken-verbatim (Gap 2). Shipped: `deriveOrgPath()`, named, unit-tested, `slug.replace(/-/g, "_")`. **Matches.**
- Phase 1/user resolution said: F16 group seeding is in scope. Shipped: three groups for congregations, one for everything else, same transaction, verified against a real DB by both the implementer and independently by QA. **Matches, and the architect's Phase 2 correction (three groups, conditional on org type) shipped correctly rather than the analyst's original two-group undercount.**
- Phase 1 said: audit event needed, no key exists (Gap 4). Shipped: `AUDIT_ACTIONS.ORG_CREATED`, correct `resourceType`/`resourceId`, present in `audit.test.ts`'s exhaustive catalog. **Matches.**
- Phase 1 said: name needs a length cap (Gap 8). Shipped: 200-char cap, client + server. **Matches.**
- Phase 1 Open Question: does the slug field warn inline that it's permanent? Shipped: yes, static warning text. **Matches.**
- Phase 3 said: type/platform_status render as shadcn `Select`. Shipped: native `<select>` styled to match, because no `Select` primitive exists in `src/components/ui/` and generating one mid-ticket would have silently pulled in a new dependency Phase 2 never evaluated. **Acceptable, well-reasoned drift** — the implementer correctly treated "no new dependency" as the binding constraint over the design doc's literal (and, on inspection, factually wrong) component name.
- Context said: this unblocks onboarding fpcw, with the org name confirmed by the user. Shipped: the generic capability to create any org — the actual fpcw row was deliberately **not** created during this pipeline (that's the orchestrator's own next step through the real UI). **Acceptable drift, but worth naming explicitly**: the business goal that motivated this ticket (a live fpcw org row) is still open after SHIP IT. Correctly out of this pipeline's scope, but "shipped" here means "the tool now exists," not "fpcw is onboarded."

## Edge Cases

- Empty state: pass — the pre-existing `[id]/page.tsx` detail page already renders correctly for a brand-new org with no brand/site row; nothing new was needed and nothing broke it.
- Failure microcopy: pass — every named failure mode has specific, human copy, verified by reading `new/actions.ts` directly.
- Permission gate: pass — two layers (page-level inline gate, action-level `auth()`+`hasFeature()`), byte-identical to the other actions on this surface, plus an e2e test proving a member is bounced to `/access-pending` before ever reaching the form.
- Audit event: pass — `ORG_CREATED` fires on success only, correct `resourceType`/`resourceId`/`metadata`, unit-tested for the exact call shape.
- Mobile (360px): pass — real, automated, viewport-scoped e2e assertion, not a manual one-time check.

**Process gap worth naming:** Phase 1 in this work-log has no explicit adversarial (Pass 5) section — no line reasoning through redirect targets, state-machine shortcuts, enumeration, or self-targeting. Doing that pass retroactively: no user-controlled redirect exists (the post-create navigation target is the server-generated new org's own id, never client input); no state machine to skip (one form, one submit); no enumeration surface (the action requires `ADMIN_ORGANIZATIONS` before any DB lookup, so a non-admin gets "Forbidden." uniformly rather than a slug-existence signal); self-targeting doesn't apply. The omission didn't cost anything here, but it's a real process gap in how this Phase 1 was run, named rather than papered over by a clean retroactive check.

## Follow-Ups (SHIP WITH NOTES)

- **Add a DB-backed regression test for `scripts/seed.ts`'s `seedGroupTypes()` idempotency** (QA's first named gap — accepted). `scripts/seed.ts` has zero pre-existing test coverage repo-wide, this is exactly the class of bug (`.onConflictDoNothing()` silently not being idempotent) that already bit the codebase once for real in `sites.test.ts` — 82 duplicate rows sitting in the shared dev DB right now, not hypothetical — and a future "simplification" of `seedGroupTypes()` back toward that pattern would ship silently with nothing to catch it. Bundle with the already-tracked `docs/TODO.md` `sites.test.ts` cleanup line since both trace to the same missing-unique-constraint root cause.
- **`createOrganization()`'s `provisioning_incomplete` branch untested against a real DB** (QA's second named gap) — **accepted as fine-as-is, no follow-up ticket.** The precondition it guards is now itself prevented by `seedGroupTypes()`'s own idempotent bootstrap, the branch is exercised at the mocked action layer, and manufacturing a real DB missing those rows just to exercise this one line costs more than it's worth.
- **Required before this diff is committed** (Workflow Rules 10/14, not a deferred ticket): `docs/product/functionality-map.md`'s Organizations line doesn't yet mention org creation; `docs/TODO.md` needs the accepted follow-up above added; a release-notes entry is owed for the next cut. All three belong in the same commit that lands this feature.
- **Not a code follow-up, but don't let it get lost**: the actual fpcw org row has not been created yet. The tool this pipeline built is done; the onboarding action it exists to enable is still open.

No `whats_new_entries` post warranted (Rule 13) — internal admin tooling,
no member-visible behavior. No feedback row to mark `done` (Rule 12) —
this work originated from mid-task discovery, not an in-app feedback
submission.
