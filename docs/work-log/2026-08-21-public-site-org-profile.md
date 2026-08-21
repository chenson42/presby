# Public-site organization profile data — Work Log

> **Slug:** `2026-08-21-public-site-org-profile`
> **Surface:** `(admin)` for editing, `(public)/site/<slug>` for anonymous reading
> **Permission(s):** existing `FEATURES.ADMIN_ORGANIZATIONS` covers editing; no new tenant permission
> **Flag(s):** rides along with existing `sites.public_render`; consider whether admin editing needs its own flag
> **Estimated complexity:** small-medium
> **Pipeline mode:** Full, run with agents — but keep it tight; this is a well-scoped data addition, not a new subsystem

---

## Context

Blocking the public-sites component library work in `presby-site-kit`
(`docs/work-log/2026-08-20-public-sites.md`). Comparing a real church's
current website (structure only, never its actual content — see CLAUDE.md
"No Real Data") against presby's schema surfaced a real gap: every
church-website template leans on organization-level profile data that
`organizations` doesn't carry today —

- Street address (for a "get directions" link/map embed)
- Phone number
- Regular service times (distinct from `roll_actions`/scheduling — this is
  publish-facing prose/structured text like "Sundays 10:15 a.m.", not a
  calendar system)
- Office hours
- Social links (Facebook, Instagram, etc. — an open-ended small set)

None of this is roll/officer/roll-of-members data — it's public-facing
profile data, closer in shape to `organization_brands` (one row per org,
operator/admin-editable, publicly readable through the same kind of
SECURITY DEFINER collapse `presby_published_site()` already uses) than to
anything in the core polity schema. Whatever Phase 1 lands on, it must
respect the same enumeration-safety property `organization_sites` already
established: a site that isn't live should not leak profile data any more
than it leaks page content.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-21 |
| 2 — Architectural review | architect | Complete | Approved with suggestions — DECISION-090/091 | 2026-08-21 |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> A small, well-precedented profile-data addition (address/phone/service-times/office-hours/social-links, one row per org, admin-edited, publicly read through the same `presby_published_site()` enumeration-safe collapse) — but three shape questions (editing model, service-times structure, social-links openness) need the user's answer before Phase 3 locks columns, and "platform-admin-only editing" is a real product regression for a church used to self-editing this in WordPress, not a rubber-stamp detail.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`(admin)/admin/organizations/[id]`, `FEATURES.ADMIN_ORGANIZATIONS`) | Sets/edits address, phone, service-times text, office-hours text, social links for one org | On demand, low frequency (onboarding + occasional updates) |
| Anonymous visitor (`(public)/site/<slug>`) | Reads profile data as rendered by presby-site-kit components (Hero, ServiceTimes, ContactForm's address hint, footer social icons, etc.) | Per page view |
| Tenant member (`(org)`) | **None.** No verb exists for a church's own staff to touch this data in this pipeline — see Out of Scope #1. |

No verb in the request names "the user" ambiguously — the request itself already separates admin-sets from anonymous-reads, which is the right split. The gap is that "admin" here means *platform* admin, not the congregation's own admin, and that's worth surfacing rather than assuming.

## Flows

**Flow 1 — Admin sets org profile data:** entry `/admin/organizations/[id]` (existing organization detail page, alongside `brand-form.tsx`) → step: admin fills address / phone / service-times / office-hours / social-links form → step: submits → outcome: row upserted (insert-or-update, one row per org, matching `organization_brands`'/`organization_sites`' degenerate-PK pattern), admin sees confirmation.
- Failure: validation errors shown inline (e.g., malformed social URL, overlong text) — server-side, not just client-side. A DB/network failure shows human microcopy ("couldn't save — try again"), not a stack trace, and the admin's typed values survive the failed submit (re-render with prior form state, don't blank the form).

**Flow 2 — Anonymous visitor views a live site's profile-derived content:** entry `/site/<slug>` → step: presby-site-kit's Hero/ServiceTimes/ContactForm/footer components render server-side from the same bundle `getPublishedSite()` already assembles → outcome: address/phone/hours/social render if the admin set them.
- Failure/empty: a field the admin left blank (churches don't have to fill in social links) must degrade to *omitting that piece of UI*, not a blank line or a "Not set" placeholder — e.g., no "Get Directions" link at all if no address, no social-icon row at all if every platform is empty. This needs to be a concrete, named answer per component in Phase 3, not a default the ux-developer improvises per-component inconsistently.

**Flow 3 — Anonymous visitor on a non-live site:** entry `/site/<slug>` where the org was never provisioned, is `suspended`, or the slug doesn't exist → same 404 collapse `presby_published_site()` already guarantees for page content and brand tokens. Profile data must fold into *that same* SECURITY DEFINER read, not a second query — a second, independently-gated read is exactly how this kind of architecture grows a leak (see Gap 5 below).

## Permissions & Flags

- **Permission(s):** Reuse `FEATURES.ADMIN_ORGANIZATIONS` for editing. No new permission — matches the `organization_brands` precedent exactly (same admin, same surface, same "set at onboarding, occasionally touched up" cadence).
- **Default roles:** Whichever principals already carry `ADMIN_ORGANIZATIONS` today (platform admin only).
- **Flag(s):** Ride along inside `sites.public_render` — do not add a new flag. The entire anonymous render path already collapses on `sites.public_render` + `organization_sites.status = 'live'` in one SECURITY DEFINER function; a profile-specific flag would let profile data go live independently of the rest of a site's content, which has no product rationale, and would double the enumeration-safety surface QA has to re-verify for no benefit. Editing itself needs no flag either — a permission-gated platform-admin write through `getPlatformDb()` that writes to a field nothing renders yet (flag off, or org not live) is inert by construction.

## Gaps the Request Didn't Address

1. **Service times / office hours: free text vs. structured.** Recommend plain free text (or a short list of strings) over structured start/end-time columns — real schedules are irregular, this is explicitly not `roll_actions`/scheduling, and structure buys nothing until a second consumer (ICS export, "next service" countdown) exists.
2. **Address: single free-text string vs. structured/geocoded.** A "get directions" link only needs one URL-encoded string for a Maps deep link. Structured/geocoded address only earns its keep if presby renders its own embedded map later (new vendor dependency, architect territory). Recommend free text now, flag structured/geocoded as an explicit later item.
3. **Social links: fixed named columns vs. open set.** CLAUDE.md's D8 invariant ("No custom fields... tags are the only tenant-extensible attribute") is directly relevant — an unbounded key-value social-links store risks becoming the custom-field escape hatch D8 exists to prevent. Recommend a small fixed list of well-known platforms as nullable text columns (facebook, instagram, x/twitter, youtube, other-url).
4. **Table shape: new sibling table vs. extending `organization_sites`.** Recommend a new table (e.g. `organization_profiles`), matching the degenerate-PK/FORCE-RLS pattern — `organization_sites`' own header explicitly scopes it to provisioning/ingest bookkeeping, and folding publish-facing prose into it blurs a table whose job is currently precise. Exact grant shape (a `presby_app` SELECT like `organization_brands`, or none at all like `organization_sites`) is Phase 2/3's call.
5. **Enumeration safety, mechanically.** Profile fields must be added to `presby_published_site()`'s existing `SELECT` (more columns on the same SECURITY DEFINER function), never a second query or function — a hard Phase 3 requirement, not an implementer nicety.
6. **Empty state, concretely, per component.** Every org starts with zero profile fields filled in, including the real first church before someone types in its office hours. Phase 3 needs a named answer for what Hero/ServiceTimes/ContactForm/footer literally render with nothing set (recommendation: omit the section entirely, never a blank placeholder).
7. **2FA gate.** N/A — touches no auth flow beyond the existing `/admin` Edge gate.
8. **Audit events.** Not read as security-sensitive in the `audit_events` sense (this is public content, not access control). Recommend a plain `updated_by`/`updated_at` pair (matching `organization_sites`' own precedent), not a full audit-event write. Whether restore-style history (`organization_brand_history`-style) is wanted is an open question below.
9. **Mobile (360px).** presby-site-kit's component-rendering concern, not this data-only slice's.

## Out of Scope (confirm with user)

- **A tenant-facing self-service editor.** `src/lib/sites.ts`'s own header confirms "no tenant site editor" was already ruled dead in the public-sites pipeline. But this specific data (a changed Sunday time, new office hours) is exactly the kind of thing a church's own office staff routinely updates — if the real reference church currently self-edits this in WordPress, requiring a platform-admin edit for something that routine is a real day-to-day regression, not a nitpick. See Open Question 1.
- Structured, geocoded address / interactive embedded map.
- Machine-parseable service-time data (countdown widgets, calendar/ICS export).
- Multiple locations/campuses — one row per org assumes a single physical address.
- Edit history/versioning — starting without it unless the user wants restore capability.
- `StaffList`'s staff data — one of the ten named site-kit components, but staff bios/photos aren't among this ticket's five fields; confirm it's a separately-scoped follow-up (people/officers-sourced), not silently expected to ride along here.

## Open Questions

1. Is platform-admin-only editing acceptable for v1, given the real reference church self-edits this content in WordPress today — or does this need a tenant-admin-facing surface sooner?
2. Service times / office hours: plain free text sufficient, or does any planned component need structured start/end times?
3. Social links: fixed short named-platform list, or a fully open set (any platform, any URL)?
4. Does "get directions" need more than a single free-text address turned into a maps deep link — is a geocoded embedded map planned soon enough that the column shape should account for it now?
5. New sibling table (`organization_profiles`) vs. extending `organization_sites` directly — preference, or leave to Phase 2/3?
6. Any appetite for lightweight edit history, or is `updated_by`/`updated_at` enough?

*Recorded by the orchestrator from the read-only analyst agent's report.*

## Open Questions — resolved by the user (2026-08-21)

1. **Platform-admin-only editing for v1.** A tenant-admin self-edit surface is deferred as its own future follow-up, same pattern as the brand editor's own deferred slice d.
2. **Structured service times** — a real schema (day, start time, end time, label), not free text. Chosen over the analyst's free-text recommendation — the user wants this structured from the start.
3. **Social links: fixed named platforms** (facebook / instagram / x-twitter / youtube / other-url), nullable columns — matches D8.
4. **Address: simple free text**, URL-encoded into a maps deep link. No geocoding, no new dependency.
5. **Table shape** (new sibling table vs. extending `organization_sites`) — left to Phase 2/3, per the analyst's own suggestion.
6. **Edit history** — no strong signal from the user; default to `updated_by`/`updated_at` only (analyst's recommendation), no `organization_brand_history`-style table, unless Phase 2/3 finds a reason to reconsider.

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

# Phase 2 — Architectural Review (architect)

## Verdict

Approved with suggestions.

## Placement

- Not a new domain file — `src/lib/db/domain/sites.ts` (already the established home for the public-sites domain; its header comment needs updating from "two tables" to "three," since the grant-asymmetry story changes).
- Migration: hand-written, `drizzle/00XX_presby_site_profile.sql`, idempotent `do $$ ... if not exists ... $$` pattern matching `0020`.
- No new dependency — Postgres native `time` type for structured service times; the maps link is `encodeURIComponent()` on plain text, no geocoding vendor.

## Ruling on table shape (Q5): new sibling table, confirmed

Read `organization_sites`' actual table comment directly, not the analyst's summary of it: "NO PUBLIC GRANT and NO presby_app TABLE GRANT, EVER" is a hard marker on that specific table, and the same comment confirms a tenant editor was "confirmed dead" for it. **Ruling: new table, `organization_profiles`** — degenerate PK (`organization_id`), FORCE RLS, `updated_by`/`updated_at` only (per the user's Q6 resolution — no history table). Same shape as `organization_brands`, not `organization_sites`.

## Ruling on grant shape (Q6): follow `organization_brands`, not `organization_sites`

`organization_brands` was granted the **full standard verb set** (`select, insert, update, delete`) to `presby_app` up front, *before* any tenant-facing consumer existed — declared that way specifically so a later editor needs no migration of its own. `organization_sites` went the opposite way because its own comment confirms a tenant editor was "confirmed dead" for that data. The user's Q1 resolution supplies the deciding fact here: platform-admin-only editing is "deferred as its own future follow-up, **same pattern as the brand editor's own deferred slice d**" — explicitly binding this table to the `organization_brands` precedent by name.

**Ruling:** `organization_profiles` and `organization_service_times` get FORCE RLS + a `tenant_isolation` policy, and a full standard `presby_app` grant declared now, unused until the deferred tenant-editor pipeline lands. **Condition on this ruling:** the deferred tenant-editor follow-up must be a named `docs/TODO.md` line, not left as only a work-log answer — done, see TODO.md (added by the orchestrator alongside DECISION-090).

## Service times: a genuine child table, not JSONB

The user chose structure over the analyst's free-text recommendation *specifically* to get real schema — a JSONB array column would be schema-less at the database layer (no per-entry `CHECK`, no `time` typing, no planner visibility) and would silently reintroduce the free-text problem one level down. **Ruling:** `organization_service_times`, a real child table — `organization_id uuid not null references organizations(id) on delete cascade`, `day_of_week` (`CHECK`-enumerated), `start_time time not null`, `end_time time not null`, `label text` nullable, `unique (id, organization_id)` per Composite Tenant Keys (matching `site_contact_messages`' "kept for consistency even with no current composite-FK consumer" precedent), own FORCE RLS policy matching `organization_profiles`.

**Open, not the architect's to close:** whether office hours shares this shape via a `kind` discriminator (`'service' | 'office_hours'`) on the same table, or stays a free-text column on `organization_profiles`. The user's Q2 resolution named "service times" specifically; office hours wasn't named. Phase 3 must ask, not assume.

## Confirmed: `presby_published_site()` requirement, plus a real gotcha

Read the function as currently defined (not just its comment) — a plain three-table join, `security definer`, `stable`, `revoke all from public` / `grant execute to presby_app`. Scalar profile columns join in exactly like `organization_brands` already does (`left join`, nullable). Service times aggregate via a correlated `jsonb_agg` subquery in the same `SELECT` list — still one function, one round trip, satisfies Phase 1 Gap 5.

**Gotcha for database-admin:** `CREATE OR REPLACE FUNCTION` cannot change a `RETURNS TABLE(...)` signature by appending columns — Postgres errors. The migration must `drop function if exists presby_published_site(text);` before recreating it with the widened return list.

## Invariants Touched

- **Isolation Is a Database Property** — both new tables get FORCE RLS + `presby_current_org()` policies, matching every tenant table's baseline, even though the only exercised read path (`presby_published_site()`) is SECURITY DEFINER and bypasses RLS by design (same F26 shape as `organization_brands`/`organization_sites`).
- **Composite Tenant Keys** — `organization_service_times` carries `unique (id, organization_id)` with no current composite-FK consumer, per the `site_contact_messages` precedent.
- **Permissions vs Flags** — kept separate: `FEATURES.ADMIN_ORGANIZATIONS` (permission, editing), `sites.public_render` + `organization_sites.status = 'live'` (flag + status, existing collapse). No new flag.
- **Extensibility Goes Through Support (D8)** — social links as five fixed nullable columns, not an open key-value store. Confirmed compliant.
- **No Role Carries a Wildcard** — the forward-looking `presby_app` grant is bounded by FORCE RLS the same way `organization_brands`' was; inert, not a wildcard, until a consumer exercises it.

## Notes for Phase 3

1. Table names: `organization_profiles` (address/phone/social-link columns, `updated_by`/`updated_at`), `organization_service_times` (child table, composite tenant key, `day_of_week`/`start_time`/`end_time`/`label`).
2. Resolve with the user whether office hours shares `organization_service_times`'s shape via a `kind` discriminator, or stays free text on `organization_profiles`.
3. Grant shape as ruled above — condition satisfied, TODO.md line added.
4. `presby_published_site()`: `drop function` + recreate, not `create or replace` — signature change.
5. No new asset type, no storage-adapter involvement, no change to `(public)/site/<slug>`'s brandability scope.

*Recorded by the orchestrator from the read-only architect agent's report.*

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
