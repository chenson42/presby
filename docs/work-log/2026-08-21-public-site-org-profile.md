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
| 3 — Technical design | tech-lead | Complete | Design complete — DECISION-092; implementer named (database-admin, then full-stack-developer) | 2026-08-21 |
| 4 — Implementation | database-admin (schema), full-stack-developer (query/actions/UI, then e2e-gap closure) | Complete (commit 1 + commit 2 + commit 3) | — | 2026-08-21 |
| 5 — Verification | qa | Complete | FAIL (first pass, e2e gap) → PASS (re-verification after commit 3 closed it) | 2026-08-21 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-08-21 |

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

## Open question resolved by the user (2026-08-21)

**Office hours shares `organization_service_times`'s structured shape**, via a `kind` discriminator (`'service' | 'office_hours'`) rather than a second table or a free-text column on `organization_profiles`.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Two new tables (`organization_profiles`, `organization_service_times`) carry the address/phone/social-links/service-times/office-hours data a church website template needs but `organizations` doesn't have. A platform admin sets it at `/admin/organizations/[id]`, two new sections below the existing "Set brand" section, same shape as `BrandForm`/`SiteSection`. The anonymous read folds into `presby_published_site()` — the one SECURITY DEFINER function `getPublishedSite()` already calls — so a non-live site still leaks nothing (Phase 1 Gap 5), and every field is independently omittable on the read side so presby-site-kit's components can render or skip a section with no null-checking gymnastics of their own. No new permission, no new flag, no audit event, no history table — all four already settled in Phase 1/2; this phase turns those rulings into exact columns, exact function signatures, and an exact form.

## Permissions & Flags

- Permission key(s): `FEATURES.ADMIN_ORGANIZATIONS` (`admin.organizations`) — reused as-is, no new key. Same admin, same surface, same cadence as `organization_brands`.
- Default role bindings: whichever principals already carry `ADMIN_ORGANIZATIONS` today (platform admin only). No change.
- Feature flag(s): not needed. The anonymous render path stays gated entirely by `sites.public_render` + `organization_sites.status = 'live'`, both already enforced inside `presby_published_site()`/`getPublishedSite()`. A platform-admin write through `getPlatformDb()` to a field nothing renders while the flag is off is inert by construction (Phase 1's own reasoning, unchanged).

## API Contract

All server actions live in `src/app/(admin)/admin/organizations/[id]/actions.ts`, matching `setOrganizationBrandAction`'s exact shape: `FormData` in, `Promise<PolicyResult>` out (`PolicyResult` is already exported from this file — reused, not redefined). Each is a thin wrapper: auth + `hasFeature` + UUID/FormData parsing + `revalidatePath`, delegating the real query/validation/upsert to `src/lib/sites.ts` (matching how `provisionSiteAction`/`setSiteStatusAction` already wrap `provisionSite`/`setSiteStatus`, not how `setOrganizationBrandAction` inlines its own query — this data is "sites" domain per the architect's placement ruling, not "org brand" domain).

```
// src/app/(admin)/admin/organizations/[id]/actions.ts
async function setOrganizationProfileAction(formData: FormData): Promise<PolicyResult>
  // FormData: organizationId (uuid), address, phone, facebookUrl, instagramUrl,
  // xTwitterUrl, youtubeUrl, otherUrl (all optional strings; empty -> null)

async function setOrganizationServiceTimesAction(formData: FormData): Promise<PolicyResult>
  // FormData: organizationId (uuid), kind ("service" | "office_hours"),
  // rows (JSON string: Array<{ dayOfWeek: number; startTime: string; endTime: string; label: string | null }>)
  // Whole-list replace for that (organizationId, kind) pair — DECISION-092.
```

```
// src/lib/sites.ts — new exports, alongside provisionSite/setSiteStatus

interface OrganizationProfileAdminDetail {
  address: string | null;
  phone: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  xTwitterUrl: string | null;
  youtubeUrl: string | null;
  otherUrl: string | null;
  updatedAt: string | null;
}
async function getOrganizationProfileAdminDetail(organizationId: string): Promise<OrganizationProfileAdminDetail | null>

type SetOrganizationProfileResult = { kind: "ok" } | { kind: "invalid_input"; error: string };
async function setOrganizationProfile(
  organizationId: string,
  input: { address: string; phone: string; facebookUrl: string; instagramUrl: string; xTwitterUrl: string; youtubeUrl: string; otherUrl: string },
  actorUserId: string,
): Promise<SetOrganizationProfileResult>
  // Validates, then upserts (onConflictDoUpdate on organizationId) — exact
  // upsert shape as setOrganizationBrandAction's, minus history-row insert
  // (no history table for this feature, resolved Q6).

interface ServiceTimeAdminEntry {
  id: string; kind: "service" | "office_hours"; dayOfWeek: number;
  startTime: string; endTime: string; label: string | null;
}
async function listOrganizationServiceTimes(organizationId: string): Promise<ServiceTimeAdminEntry[]>
  // Both kinds, ordered (kind, day_of_week, start_time) — the page splits by kind for the two editors.

type ReplaceServiceTimesResult = { kind: "ok" } | { kind: "invalid_input"; error: string };
async function replaceOrganizationServiceTimes(
  organizationId: string,
  kind: "service" | "office_hours",
  rows: Array<{ dayOfWeek: number; startTime: string; endTime: string; label: string | null }>,
  actorUserId: string,
): Promise<ReplaceServiceTimesResult>
  // One transaction: delete where (organizationId, kind), then insert rows
  // (skip insert entirely if rows.length === 0 — "save an empty list" is a
  // legal way to clear a kind, see Edge Cases).
```

`getPublishedSite()` (existing, `src/lib/sites.ts`) widens its `PublishedSiteRow`/`PublishedSite` shapes — no new exported function, per Phase 1 Gap 5 ("never a second query or function"):

```
export interface PublishedSite {
  // ...unchanged fields (organizationId, organizationName, organizationType,
  // brand, pages, imageKeys)...
  profile: {
    address: string | null;
    phone: string | null;
    social: {
      facebook: string | null;
      instagram: string | null;
      xTwitter: string | null;
      youtube: string | null;
      other: string | null;
    };
  };
  serviceTimes: OrgServiceTimeEntry[]; // [] if none set
  officeHours: OrgServiceTimeEntry[];  // [] if none set
}
export interface OrgServiceTimeEntry {
  dayOfWeek: number; // 0=Sunday..6=Saturday, matching JS Date.getDay()
  startTime: string; // "HH:MM:SS", Postgres `time` literal as returned
  endTime: string;
  label: string | null;
}
```

**Hard requirement for presby-site-kit's read side, named explicitly (Phase 1 Gap 6):** every one of these fields is independently omittable, and the contract is per-field, not per-object —
- `profile.address === null` → no "Get Directions" link/section at all, not a blank line.
- `profile.phone === null` → no phone display at all.
- Every key of `profile.social` is independently `null`-or-a-URL — a footer/social-icon row renders **only** the non-null entries, and renders **no row at all** if every key is `null`. Never a placeholder icon for an unset platform.
- `serviceTimes.length === 0` → the `ServiceTimes` section doesn't render.
- `officeHours.length === 0` → the office-hours section doesn't render.
- `profile` itself is never `null` — the object always exists, with every leaf independently `null`/`[]`. Components check leaves, not the presence of `profile`.

## Data Model

Migration `drizzle/0021_presby_site_profile.sql`, hand-written and idempotent (`do $$ ... if not exists ... $$`), matching `0020`'s own structure. Drizzle `pgTable` definitions land in `src/lib/db/domain/sites.ts` (architect's placement ruling — this is "sites" domain, not `org.ts`), RLS/grants/function live in the migration only (DECISION-061 convention).

**`organization_profiles`** — degenerate PK, matching `organization_brands` exactly:

| Column | Type | Notes |
|---|---|---|
| `organization_id` | `uuid primary key references organizations(id) on delete cascade` | Degenerate composite key, one row per org. |
| `address` | `text` | Nullable. Single free-text line (Phase 1 Q4) — URL-encoded into a maps deep link by the reading component; no structured/geocoded shape. |
| `phone` | `text` | Nullable. Free text — no format CHECK (international formats vary; app-level max-length only). |
| `facebook_url` | `text` | Nullable. |
| `instagram_url` | `text` | Nullable. |
| `x_twitter_url` | `text` | Nullable. |
| `youtube_url` | `text` | Nullable. |
| `other_url` | `text` | Nullable. Five fixed columns (Phase 1 Q3 / D8) — no open key-value social-links store. |
| `updated_by` | `uuid not null references users(id)` | Always human-attributed — no machine writer exists for this table (unlike `organization_sites.updated_by`, which is nullable for ingest). |
| `updated_at` | `timestamptz not null default now()` | No `created_at` column — matches `organization_brands`' own precedent exactly (first `updated_at` **is** the creation event). No history table (resolved Q6). |

No DB-level length `CHECK`s on the text columns — app-level validation only (`site_contact_messages.body`'s own precedent: a 5000-char bound lives in `submitSiteContactMessage`, not a migration `CHECK`). URL columns get app-level `new URL()` well-formedness validation (must parse, `http:`/`https:` protocol only) in `setOrganizationProfile` — not a platform-domain check (a `facebookUrl` need not literally contain `facebook.com`; a custom Linktree-style URL in that field is legal).

**`organization_service_times`** — genuine child table (DECISION-091), matching `site_contact_messages`' composite-key shape:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | |
| `organization_id` | `uuid not null references organizations(id) on delete cascade` | |
| `kind` | `text not null` | `CHECK (kind in ('service', 'office_hours'))`. |
| `day_of_week` | `smallint not null` | `CHECK (day_of_week between 0 and 6)`. 0=Sunday..6=Saturday — matches JS `Date.getDay()`, stated explicitly so presby-site-kit never has to guess the convention. |
| `start_time` | `time not null` | No time zone — a congregation's own wall-clock time, not a UTC instant; there is no date component, so no DST math applies. |
| `end_time` | `time not null` | `CHECK (end_time > start_time)` — per-row ordering only; see Edge Cases for why cross-row overlap is deliberately **not** validated. |
| `label` | `text` | Nullable — e.g. "Traditional", "Contemporary (Spanish)", "Front office". App-level max length only. |
| `updated_by` | `uuid not null references users(id)` | Per-row attribution — cheap to keep even under whole-list replace (DECISION-092), and answers "who set the 10:15 service" without a join to `organization_profiles`, which may never have been touched if only service times were ever edited. |

Indexes/constraints: `unique (id, organization_id)` (Composite Tenant Keys convention, architect's ruling — no current composite-FK consumer, kept for consistency per the `site_contact_messages` precedent). `create index organization_service_times_org_kind_idx on organization_service_times (organization_id, kind, day_of_week, start_time)` — backs both the admin list read and the `jsonb_agg` subquery's `order by`.

**RLS + grants** (both tables, in the migration's own `site_tables`-style loop, alongside — not replacing — `0020`'s `site_tables` array, since that array is declared in a prior migration and this is a new one):

```sql
alter table organization_profiles enable row level security;
alter table organization_profiles force row level security;
create policy tenant_isolation on organization_profiles
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());
-- identical block for organization_service_times

grant select, insert, update, delete on organization_profiles, organization_service_times to presby_platform;
grant select, insert, update, delete on organization_profiles, organization_service_times to presby_app;
```

FORCE RLS on both even though the only exercised read path (`presby_published_site()`) is SECURITY DEFINER and bypasses RLS by design — matching every tenant table's baseline (F1), and specifically matching `organization_brands`' own reasoning: the `presby_app` grant is forward-looking (DECISION-090), inert until the deferred tenant-editor (`docs/TODO.md`) lands, and FORCE RLS is what keeps "inert" true rather than "a bare grant with no policy," which DECISION-049 already named as the thing to never do.

**`presby_published_site(text)` — drop and recreate, not `create or replace`** (the architect's own gotcha: Postgres refuses to append columns to an existing `RETURNS TABLE(...)` via `CREATE OR REPLACE`):

```sql
drop function if exists presby_published_site(text);

create function presby_published_site(p_slug text)
returns table (
  organization_id           uuid,
  organization_name         text,
  organization_type         text,
  content_bundle_key        uuid,
  brand_seed_hex            text,
  brand_type_pairing        text,
  brand_token_version       integer,
  profile_address           text,
  profile_phone             text,
  profile_facebook_url      text,
  profile_instagram_url     text,
  profile_x_twitter_url     text,
  profile_youtube_url       text,
  profile_other_url         text,
  service_times             jsonb,
  office_hours              jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.name, o.organization_type::text,
         s.content_bundle_key,
         b.seed_hex, b.type_pairing, b.brand_token_version,
         p.address, p.phone, p.facebook_url, p.instagram_url,
         p.x_twitter_url, p.youtube_url, p.other_url,
         (select jsonb_agg(jsonb_build_object(
                    'dayOfWeek', st.day_of_week, 'startTime', st.start_time,
                    'endTime', st.end_time, 'label', st.label)
                  order by st.day_of_week, st.start_time)
            from organization_service_times st
           where st.organization_id = o.id and st.kind = 'service') as service_times,
         (select jsonb_agg(jsonb_build_object(
                    'dayOfWeek', st.day_of_week, 'startTime', st.start_time,
                    'endTime', st.end_time, 'label', st.label)
                  order by st.day_of_week, st.start_time)
            from organization_service_times st
           where st.organization_id = o.id and st.kind = 'office_hours') as office_hours
    from organizations o
    join organization_sites s on s.organization_id = o.id
    left join organization_brands b on b.organization_id = o.id
    left join organization_profiles p on p.organization_id = o.id
   where o.slug = p_slug
     and o.status = 'active'
     and s.status = 'live';
$$;

revoke all on function presby_published_site(text) from public;
grant execute on function presby_published_site(text) to presby_app;
```

`jsonb_agg` over zero matching rows returns `NULL`, not `[]` — the query layer (`getPublishedSite()`) maps `NULL` to `[]` explicitly (see API Contract); the SQL itself does not `coalesce`, since `NULL` is already the correct "nothing to aggregate" signal and coalescing in SQL would just move the same mapping one layer down for no gain.

## Component / Page Plan

- Pages to create: none — everything lands on the existing `/admin/organizations/[id]` route.
- Components to create:
  - `src/app/(admin)/admin/organizations/[id]/profile-form.tsx` (client) — address/phone/five social-URL fields, one `useActionState` form, exact structural pattern as `brand-form.tsx` (inline result banner, no toast-only feedback, typed values survive a failed submit because state is client-owned and never reset from the action result).
  - `src/app/(admin)/admin/organizations/[id]/service-times-section.tsx` (client) — two independent instances of a `TimeRowsEditor` (kind=`service`, kind=`office_hours`), each: a list of rows in `useState` (day-of-week `<select>`, two `<input type="time">`, an optional label `<input>`), add/remove-row buttons, one Save button per kind serializing its row array to JSON into a hidden field and posting through `useActionState` to `setOrganizationServiceTimesAction`. Two saves, not one combined save — a church may set service times without office hours and the reverse; coupling them into one submit would force an all-or-nothing save neither Phase 1 nor Phase 2 asked for.
- Files to modify:
  - `src/app/(admin)/admin/organizations/[id]/actions.ts` — add `setOrganizationProfileAction`, `setOrganizationServiceTimesAction` (thin wrappers, see API Contract). Reuses the existing `revalidateLiveSitePath` helper unchanged.
  - `src/app/(admin)/admin/organizations/[id]/page.tsx` — fetch `getOrganizationProfileAdminDetail` + `listOrganizationServiceTimes` (split by `kind` for the two editors) alongside the existing `getSiteAdminDetail`/brand reads; render two new sections, ordered **Current brand → Set brand → Profile → Service times & office hours → Site** (profile/schedule data belongs with "what the org's public content says" ahead of "is the site even live").
  - `src/lib/sites.ts` — add the four functions in API Contract; widen `PublishedSiteRow`/`PublishedSite`/`getPublishedSite()`'s mapping logic (parse `service_times`/`office_hours` defensively — `typeof value === "string" ? JSON.parse(value) : value`, wrapped in try/catch degrading to `[]` on malformed data, matching `isStoredSiteBundle`'s own degrade-gracefully posture, never a 500).
  - `src/lib/db/domain/sites.ts` — add `organizationProfiles`, `organizationServiceTimes` `pgTable` definitions; update the file's own header comment from "two tables" to "four."
  - `drizzle/0021_presby_site_profile.sql` — new file, per Data Model above.

## Implementation Order

1. Schema: `organizationProfiles`/`organizationServiceTimes` in `src/lib/db/domain/sites.ts` + `drizzle/0021_presby_site_profile.sql` (tables, CHECKs, `unique(id, organization_id)`, index, FORCE RLS + grants, `presby_published_site()` drop-and-recreate) → apply via `npm run db:push` on a Neon branch, confirm with `scripts/test-rls.sql`.
2. `FEATURE_CATALOG` / seed binding: not needed — `FEATURES.ADMIN_ORGANIZATIONS` already exists and is already bound.
3. Query layer + server actions: the four `src/lib/sites.ts` exports, `getPublishedSite()` widened, the two new `actions.ts` wrappers.
4. UI: `profile-form.tsx`, `service-times-section.tsx`, `page.tsx` wiring.
5. Audit events: none — see Edge Cases for why this is deliberate, not an oversight.
6. Release notes entry: tech-lead, at Phase 6 SHIP IT, per Ownership.

## Edge Cases & Risks

- **No audit event, by design (Phase 1 Gap 8).** Neither new action calls `recordAudit`. This is public content, not an access-control or security-sensitive mutation — matches `markSiteContactMessageReadAction`'s identical posture (DECISION-089: "reading your own inbox is not a security-sensitive mutation"; setting a phone number is the same class of routine content edit). `updated_by`/`updated_at` is the whole attribution story, by the user's own Q6 resolution. Mechanically moot either way: `scripts/check-audit-coverage.mjs` only scans `src/app/**/actions.ts` for a literal `db.insert|update|delete` token, and both new actions call into `src/lib/sites.ts` (`platformDb.insert(...)`/`tx.insert(...)`), never a bare `db.` mutation in `actions.ts` itself — the tripwire wouldn't fire regardless, so this is a design choice, not a grep dodge.
- **Cross-row overlap is not validated; only per-row ordering is.** A CHECK enforces `end_time > start_time` on one row; nothing stops two `'service'` rows on the same `day_of_week` from overlapping. This is deliberate — a real congregation legitimately runs two simultaneous services (a Spanish-language service in the chapel while the sanctuary runs the main service, for instance), and rejecting that as "invalid" would be wrong, not merely permissive.
- **No overnight/cross-midnight service times.** `time` has no date component, so a Christmas Eve service spanning 11:00pm–12:30am cannot be represented as one row (`end_time > start_time` would reject it). Out of scope for v1 — an admin works around it with two rows and a label, or it's simply not representable yet. Named here so it isn't silently discovered as a bug later.
- **Saving an emptied row list deletes every row of that kind for the org, with no confirmation step.** `replaceOrganizationServiceTimes` with `rows.length === 0` is a legal, direct "clear all service times/office hours" — no `AlertDialog`, unlike `SuspendControl`'s destructive-confirm pattern. Accepted deliberately: single platform-admin editor, low frequency, fully recoverable by re-adding rows, no cascading effect on other tenants or on the site's live/suspended status. If this proves a real footgun in practice, add a confirm as a follow-up — not preemptively, per "minimum complexity that solves today's problem."
- **Two open browser tabs on the same org silently clobber each other** — the profile upsert and the whole-list service-time replace both have no optimistic-concurrency check. Accepted for the same reason `organization_brands`' own upsert accepts it: a single low-frequency platform-admin editor, not a multi-writer surface.
- **Malformed data degrades to empty, never a 500.** A dangling/malformed `service_times`/`office_hours` JSON value (defensive, shouldn't happen given the CHECKs, but the read path assumes nothing) parses to `[]`, not an error — matches `isStoredSiteBundle`'s own posture for the content bundle.
- **`x_twitter_url` naming consistency across three layers** — DB `x_twitter_url` (snake_case), Drizzle `xTwitterUrl` (camelCase), the read-side JSON key `xTwitter` (no `Url` suffix, since it's nested under `profile.social`). Named explicitly so an implementer doesn't introduce a mismatch between layers.
- **Existing e2e/unit blast radius — `presby_published_site()`'s signature changes, and two existing specs assert its current behavior:**
  - `src/lib/sites.test.ts` — exercises `getPublishedSite()` directly across five site-status cases (live/provisioning/suspended/unprovisioned/nonexistent-slug). None of these currently seed `organization_profiles`/`organization_service_times` rows, so the widened function should return `profile: { address: null, phone: null, social: { ...all null } }`, `serviceTimes: []`, `officeHours: []` for every existing fixture — but if any assertion in this file does exact/deep-equality on the full returned `site` object rather than checking specific fields, it will fail on the new keys and needs updating, not just re-running. The implementer must read this file's exact assertions, not assume "it still passes."
  - `e2e/public-sites.spec.ts` — real browser hits against `/site/alder-creek`, staged via direct SQL against `organization_sites`/`site_contact_messages` (that fixture has no `organization_profiles` row either, at least until this pipeline's own migration/seed work adds one). The rendered page must not error with the widened function in place; presby-site-kit's compiled components (a separate repo/package, not touched by this pipeline) simply have new bundle fields to ignore until presby-site-kit's own consuming pipeline lands, so this is expected to keep passing unmodified — confirm, don't assume.
  - `src/app/api/sites/ingest/route.test.ts` — does not touch `presby_published_site()` or either new table; not expected to need changes, named here only to rule it out explicitly rather than by omission.
- **`docs/product/functionality-map.md` and `docs/TODO.md`** — at Phase 6 SHIP IT, the functionality-map line for public sites needs the new profile fields named (Rule 14), and the `docs/TODO.md` deferred-tenant-editor line (already present, added alongside DECISION-090) stays open — this pipeline does not close it.

## Implementer

**Two commits**, split at the schema/everything-else boundary the public-sites pipeline itself already used:

1. **database-admin** — `src/lib/db/domain/sites.ts` (`pgTable` additions), `drizzle/0021_presby_site_profile.sql` (both tables, CHECKs, composite key, index, FORCE RLS + grants, `presby_published_site()` drop-and-recreate), verified against `scripts/test-rls.sql`. Schema-only, per the Implementer Selection table.
2. **full-stack-developer** — query layer (`src/lib/sites.ts` additions + `getPublishedSite()` widening), server actions (`actions.ts`), and the admin UI (`profile-form.tsx`, `service-times-section.tsx`, `page.tsx` wiring), all in one commit. Not split into api-developer + ux-developer: the UI here is two more sections bolted onto an existing detail page, reusing `Input`/`Label`/`Button`/`useActionState` wholesale with zero new primitives and zero new routes — the same "small enough that splitting adds overhead" shape the selection table names `full-stack-developer` for, not a compromise between the other two roles. `provisionSiteAction`/`ProvisionForm` already prove this exact server-action-plus-small-form shape doesn't need a three-way split even in the precedent pipeline that otherwise used three commits.

---

# Phase 4 — Implementation

**Commit 1 of 3 (database-admin, schema only).** Commits 2 and 3 (full-stack-developer) follow below, per the Implementer split named in Phase 3.

## Files Created

- `drizzle/0021_presby_site_profile.sql` — `organization_profiles` and `organization_service_times` tables, their FORCE-RLS/tenant-isolation policies, `presby_platform`/`presby_app` grants, and `presby_published_site()`'s drop-and-recreate with the widened 16-column return shape (DECISION-090/091/092), exactly per Phase 3's Data Model.

## Files Modified

- `src/lib/db/domain/sites.ts` — added `organizationProfiles`, `organizationServiceTimes` `pgTable` definitions (schema only, no query logic — DECISION-061's convention). Updated the file's header comment from "two tables" to "four," describing all four tables' grant shapes in one place.
- `scripts/test-rls.sql` — new section 17: unset-GUC invisibility, tenant isolation (Alder Creek sees its own rows, Bramblewood sees none), FORCE RLS confirmed via `pg_class.relforcerowsecurity`, and the `presby_app` full-CRUD grant confirmed directly via `information_schema.role_table_grants` — matching how section 16 verified `organization_sites`' asymmetric *no*-grant shape, applied here to prove the opposite (a real grant exists). Not explicitly named under Phase 3's "Files to modify," but "RLS verification" was named in-scope for this commit, and every prior schema commit (sections 14/15/16) added its own suite section — this follows that precedent rather than introducing a new one.
- `drizzle/meta/_journal.json` — appended the `0021_presby_site_profile` entry (idx 21), matching how 0013–0020 were each hand-registered despite `drizzle-kit generate`'s broken snapshot chain past 0012 (see the migration file's own header comment, and CLAUDE.md).

## Schema Changes

- **`organization_profiles`** (new table) — degenerate PK (`organization_id`, references `organizations(id)` cascade), `address`/`phone`/`facebook_url`/`instagram_url`/`x_twitter_url`/`youtube_url`/`other_url` (all nullable `text`, no DB-level format/length `CHECK` — app-level only, per `site_contact_messages.body`'s precedent), `updated_by` (`uuid not null references users(id)` — always human-attributed, unlike `organization_sites.updated_by`), `updated_at` (no `created_at` — first `updated_at` *is* the creation event, matching `organization_brands`). FORCE RLS + `tenant_isolation` policy. Grants: `presby_platform` and `presby_app` both get full `select, insert, update, delete` (DECISION-090 — forward-looking, contingent on the `docs/TODO.md` deferred-tenant-editor line, which already exists).
- **`organization_service_times`** (new table) — `id` PK (`gen_random_uuid()`), `organization_id` (not null, cascade), `kind` (`CHECK (kind in ('service','office_hours'))`), `day_of_week` (`smallint`, `CHECK (day_of_week between 0 and 6)`, 0=Sunday matching JS `Date.getDay()`), `start_time`/`end_time` (`time`, no timezone, `CHECK (end_time > start_time)` — per-row ordering only, cross-row overlap deliberately unvalidated per Phase 3 Edge Cases), `label` (nullable text), `updated_by` (not null, per-row attribution — DECISION-092's whole-list-replace still keeps per-row provenance). `unique (id, organization_id)` (Composite Tenant Keys convention, no current composite-FK consumer, matching `site_contact_messages`' precedent). Index `organization_service_times_org_kind_idx (organization_id, kind, day_of_week, start_time)` backs both the future admin list read and `presby_published_site()`'s `jsonb_agg ... order by`. FORCE RLS + `tenant_isolation` policy. Same `presby_platform`/`presby_app` full-CRUD grant shape as `organization_profiles`.
- **`presby_published_site(text)`** — dropped (`CREATE OR REPLACE` cannot widen a `RETURNS TABLE` signature) and recreated with 9 new trailing columns: `profile_address`, `profile_phone`, `profile_facebook_url`, `profile_instagram_url`, `profile_x_twitter_url`, `profile_youtube_url`, `profile_other_url` (scalars, `LEFT JOIN organization_profiles`, nullable exactly like the existing `brand_*` columns), `service_times`, `office_hours` (`jsonb`, two independently correlated `jsonb_agg` subqueries filtered by `kind`, per DECISION-092 — never a second query/function, satisfying Phase 1 Gap 5). Still `security definer`, `stable`, `revoke all from public` / `grant execute to presby_app` — unchanged posture, wider column list only.
- Applied via: hand-written SQL, `psql "$MIGRATE_DATABASE_URL" -f drizzle/0021_presby_site_profile.sql` against the shared dev database — **not** `npm run db:push` and **not** `npm run db:generate`, matching this repo's own established convention for every migration since 0012 (`db:generate`'s snapshot chain is broken, tracked in `docs/TODO.md`; every migration past 0012 is hand-authored and idempotent, applied by direct `psql` execution against the same connection `db:migrate` targets). Idempotent throughout: `create table if not exists`, `do $$ ... if not exists ... $$` guards on every constraint, `drop function if exists` before recreate — safe to re-run.

## Audit Events

- None. This commit writes no mutation code (schema only) — no `actions.ts` change, no `recordAudit` call to make. For the record, Phase 3's Edge Cases already ruled the eventual write path (next commit) audit-exempt: setting a phone number or service time is routine content editing, not an access-control mutation, matching `markSiteContactMessageReadAction`'s identical posture (DECISION-089).

## Implementer Notes

**RLS and grant verification, done three ways, not just "the suite passed":**
1. `scripts/test-rls.sql` section 17 (new, presby_app-only, as required) — unset-GUC invisibility, tenant isolation both directions, FORCE RLS via `pg_class`, and the grant shape via `information_schema.role_table_grants`. All 9 new assertions pass.
2. Direct catalog query as the migration owner (`MIGRATE_DATABASE_URL`, outside the presby_app-only suite): `pg_class.relforcerowsecurity = t` on both tables; `information_schema.role_table_grants` shows both `presby_app` and `presby_platform` holding `DELETE,INSERT,SELECT,UPDATE` on both tables (no partial grant, no missing verb); `pg_proc.prosecdef = t` on `presby_published_site`.
3. A live call to `presby_published_site('alder-creek')` (see below) confirming the widened return shape in practice, not just in the catalog.

**Known pre-existing dev-branch drift, unrelated to this commit — flagged, not fixed here.** `scripts/seed-dev.sql` declares Alder Creek's `organization_sites.status = 'provisioning'`, and section 16's existing assertion (`presby_published_site: provisioning (not yet live) alder-creek returns zero rows`) expects that. The live dev database instead shows `status = 'live'`, a real `content_bundle_key`, and `last_ingested_commit_sha = 'local-view-only'` — evidence of an earlier manual/e2e verification session (predating this commit) that provisioned and ingested against this branch and never reset the fixture row back to match the seed script. Confirmed unrelated to this migration: the mismatch is entirely between the live row's `status` column and the seed script's `INSERT`, nothing this migration touches. **Consequence for running the suite:** `scripts/test-rls.sql` as committed has `\set ON_ERROR_STOP on` and genuinely aborts at that pre-existing assertion (line 824) — correct behavior for that script. To get past it and confirm my own section 17 assertions independently, I ran a throwaway scratch copy with that one directive flipped off (never touching the committed file) — all 9 new assertions passed, and the only failure anywhere in the suite is the one pre-existing, out-of-scope line. Next agent/qa: either reseed `scripts/seed-dev.sql` fresh on this branch, or treat the drift as expected given real ingest testing happened here — this commit does not resolve it, since resetting another pipeline's fixture state is outside a schema-only commit's scope.

**Functional check of the widened function (task requirement, satisfied via the drift above rather than a faked transaction):** because Alder Creek's `organization_sites` row is genuinely `'live'` on this branch (see above), `presby_published_site('alder-creek')` returns exactly one row today with no faking required — `content_bundle_key` and `organization_name`/`organization_type` populated as before; `brand_seed_hex`/`brand_type_pairing`/`brand_token_version` all `NULL` (no `organization_brands` row for this org — pre-existing, unaffected by this commit); and all 9 new columns present and `NULL` — `profile_address`, `profile_phone`, and all five social columns `NULL` (no `organization_profiles` row exists for Alder Creek yet), `service_times` and `office_hours` both SQL `NULL` (no `organization_service_times` rows exist yet). This is exactly the "every field independently omittable, `profile` itself never absent" contract Phase 3's API Contract specifies — the next commit's `getPublishedSite()` must map these `NULL`s to `[]` (arrays) and `null` (scalars/social leaves), never throw or 500 on the absence.

**No deviation from Phase 3's Data Model** — table shapes, constraints, index, grant verbs, and the function's column list and two-subquery shape were implemented exactly as specified, including the deliberate non-choices (no length `CHECK`s, no cross-row overlap `CHECK`, no history table, no audit event).

**Handoff to full-stack-developer (commit 2):**
- New tables available: `organizationProfiles` and `organizationServiceTimes`, exported from `src/lib/db/domain/sites.ts` (import alongside `organizationSites`/`siteContactMessages`).
- `presby_published_site()`'s TypeScript-side caller (`getPublishedSite()` in `src/lib/sites.ts`) needs its row-mapping widened to read the 9 new columns and produce the `profile`/`serviceTimes`/`officeHours` shape Phase 3's API Contract defines — including the `NULL`-safe `jsonb` parsing Phase 3 calls out (`typeof value === "string" ? JSON.parse(value) : value`, try/catch degrading to `[]`, matching `isStoredSiteBundle`'s posture).
- `src/lib/sites.test.ts` will need updating for any assertion that does exact/deep-equality on the full `getPublishedSite()` return object — read the exact assertions before assuming "still passes," per Phase 3's own Edge Cases note.
- Local apply for a fresh clone/branch: `npm run db:push` will NOT pick up this migration correctly (Drizzle Kit's snapshot chain stops at 0012, so `db:push` would attempt to diff from a stale baseline against the current `schema.ts`+domain files and is unreliable past that point on this project, per CLAUDE.md's own note) — apply `drizzle/0021_presby_site_profile.sql` directly: `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0021_presby_site_profile.sql`. No seed change in this commit (`npm run db:seed` unaffected); commit 2 may want its own fixture row(s) in `scripts/seed-dev.sql` for `organization_profiles`/`organization_service_times` if e2e coverage needs one (none added here, matching how commit 1 of the parent 2026-08-20 pipeline seeded no `site_contact_messages` sample row either).
- `npm run typecheck` and `npm run check` (all four tripwires) both pass clean on this commit.

---

## Commit 2 of 3 (full-stack-developer — query layer, server actions, admin UI)

Query/mutation layer, server actions, and the admin UI for
`organization_profiles`/`organization_service_times`, completing Phase 3's
"Implementer" split. Everything below is additive to commit 1's landed
schema — no schema change in this commit.

### Files Created

- `src/app/(admin)/admin/organizations/[id]/profile-form.tsx` — client
  component, one `useActionState` form (address/phone/five social-URL
  fields), exact structural pattern as `brand-form.tsx` (inline result
  banner, typed values survive a failed submit — every field is
  client-owned state, never reset from the action result). Social-URL
  inputs use `type="text"`, not `type="url"` — the browser's native URL
  constraint validation silently blocks form submission for a malformed
  value before it ever reaches the server, which would defeat Phase 1's own
  "validation errors shown inline, server-side, not just client-side"
  requirement (caught by a failing jsdom test during this commit; see
  Implementer Notes).
- `src/app/(admin)/admin/organizations/[id]/profile-form.test.tsx` — jsdom
  component tests: initial render (empty + prefilled), FormData field
  mapping, success/error banner + toast, typed values surviving a failed
  submit.
- `src/app/(admin)/admin/organizations/[id]/service-times-section.tsx` —
  client component, two independent `TimeRowsEditor` instances
  (`kind="service"` / `kind="office_hours"`), each with its own row list in
  `useState` (day-of-week `<select>`, two `<input type="time">`, an
  optional label field), add/remove-row buttons, and its own Save button
  serializing the row array to JSON into a hidden `rows` field posted via
  `useActionState` to `setOrganizationServiceTimesAction`. Two independent
  saves, per Phase 3's explicit ruling — a church may set service times
  without office hours and the reverse.
- `src/app/(admin)/admin/organizations/[id]/service-times-section.test.tsx`
  — jsdom component tests: seeded render from initial entries, empty-state
  message, Add/Remove row (no action call), per-kind Save posting the right
  `organizationId`/`kind`/JSON `rows`, an empty-list save (legal "clear
  all," no confirmation step), and inline error surfacing.

### Files Modified

- `src/lib/sites.ts` —
  - Imports `organizationProfiles`, `organizationServiceTimes` from
    `@/lib/db/domain/sites`.
  - Widened `PublishedSite`/`PublishedSiteRow` and `getPublishedSite()`'s
    mapping: adds `profile: { address, phone, social: { facebook,
    instagram, xTwitter, youtube, other } }`, `serviceTimes: []`,
    `officeHours: []`. Every leaf independently `null`/`[]`, `profile`
    itself never absent — Phase 1 Gap 6 / Phase 3 API Contract's hard
    requirement. `jsonb` service-time arrays parse defensively
    (`typeof value === "string" ? JSON.parse(value) : value`, wrapped in
    try/catch, malformed/dangling data degrades to `[]`, never a 500) via a
    new `parseServiceTimeEntries()` + `isServiceTimeEntryShape()` pair. No
    new exported function, no second query — the same
    `presby_published_site()` call commit 1 shipped.
  - New exports, all `getPlatformDb()`, no membership check (same "no
    tenant membership to verify for a platform operator" posture as
    `provisionSite`/`setSiteStatus`):
    - `getOrganizationProfileAdminDetail(organizationId): Promise<OrganizationProfileAdminDetail | null>`
    - `setOrganizationProfile(organizationId, input, actorUserId): Promise<SetOrganizationProfileResult>`
      — trims address (500-char bound) and phone (50-char bound), validates
      each of the five social fields via `new URL()` well-formedness +
      `http(s):` protocol only (never a platform-domain allowlist — a
      Linktree-style URL in `otherUrl` is legal, per Phase 3's own note),
      empty string maps to `null`, upserts via `onConflictDoUpdate` on the
      degenerate `organizationId` PK. No history row (Q6's resolution).
    - `listOrganizationServiceTimes(organizationId): Promise<ServiceTimeAdminEntry[]>`
      — both kinds, ordered `(kind, day_of_week, start_time)`.
    - `replaceOrganizationServiceTimes(organizationId, kind, rows, actorUserId): Promise<ReplaceServiceTimesResult>`
      — whole-list replace per `(organizationId, kind)`, DECISION-092: one
      transaction, delete-then-insert, insert skipped entirely when
      `rows.length === 0` (a legal "clear all," no confirmation step, per
      Phase 3 Edge Cases). App-level validation mirrors the DB's own CHECKs
      (day-of-week 0–6, `"HH:MM"`/`"HH:MM:SS"` time format, `end > start`)
      so a malformed row bounces with a readable message instead of a raw
      constraint violation from the DB.
- `src/app/(admin)/admin/organizations/[id]/actions.ts` — added
  `setOrganizationProfileAction` and `setOrganizationServiceTimesAction`,
  both thin `FormData` → `Promise<PolicyResult>` wrappers delegating to
  `src/lib/sites.ts` (matching `provisionSiteAction`/`setSiteStatusAction`'s
  wrapping pattern, per Phase 3's explicit placement ruling — NOT
  `setOrganizationBrandAction`'s inline-query pattern). Each: `auth()` +
  `hasFeature(FEATURES.ADMIN_ORGANIZATIONS)` + UUID validation +
  FormData/JSON parsing + `revalidatePath` + the existing
  `revalidateLiveSitePath` helper (reused unchanged). Neither calls
  `recordAudit` — deliberate, matching `markSiteContactMessageReadAction`'s
  posture (DECISION-089), per Phase 1 Gap 8 / Phase 3 Edge Cases.
  `setOrganizationServiceTimesAction`'s own JSON parsing is limited to "is
  this well-formed, naming the right fields" — all CHECK-mirroring
  validation lives in `replaceOrganizationServiceTimes`, never duplicated
  here.
- `src/app/(admin)/admin/organizations/[id]/actions.test.ts` — added
  authorization, FormData-mapping, and result-mapping tests for both new
  actions (67 tests total in this file now, up from 47), mocking
  `setOrganizationProfile`/`replaceOrganizationServiceTimes` the same way
  `provisionSite`/`setSiteStatus` are already mocked.
- `src/app/(admin)/admin/organizations/[id]/page.tsx` — fetches
  `getOrganizationProfileAdminDetail` + `listOrganizationServiceTimes`
  (split by `kind` for the two editors) alongside the existing site/brand
  reads; renders two new sections in the order Phase 3 specified: Current
  brand → Set brand → **Profile → Service times & office hours** → Site.
- `src/lib/sites.test.ts` (Postgres-backed integration suite, run for real
  against the dev database — see Verification below) —
  - Widened the existing "live org" assertion to check the new
    `profile`/`serviceTimes`/`officeHours` fields are all-null/`[]` before
    any admin write touches that fixture (per-field `toEqual`, not a
    full-object deep-equal — see the exact-equality risk note below).
  - New `describe` block `getOrganizationProfileAdminDetail /
    setOrganizationProfile`: null-when-absent, address/phone length bounds,
    malformed-social-URL rejection (naming the field), non-http(s) scheme
    rejection, a full upsert round-trip, and update-not-insert on a second
    call.
  - New `describe` block `listOrganizationServiceTimes /
    replaceOrganizationServiceTimes`: empty-list-when-absent, out-of-range
    day-of-week rejection, malformed-time rejection, `end <= start`
    rejection (naming the day), insert + ordering, whole-list replace
    clearing the prior set, empty-list "clear all," and kind independence
    (`service` vs `office_hours` never cross-touch).
  - New `describe` block `getPublishedSite — populated profile/service-
    times flow through`, placed deliberately last in the file (file-order
    dependency documented inline): sets a full profile + both service-time
    kinds on `orgLive`, then confirms `getPublishedSite()` returns them
    through the same `presby_published_site()` call, closing the loop from
    admin write to public read.

### Schema Changes

None — commit 1's schema is unchanged. This commit is query/action/UI only.

### Env / Flags

No new env var, no new `FEATURES` entry, no new flag. `FEATURES.ADMIN_ORGANIZATIONS`
gates both new actions (unchanged, existing key); the anonymous read stays
gated entirely by `sites.public_render` + `organization_sites.status = 'live'`,
both already enforced inside `presby_published_site()`/`getPublishedSite()`
— per Phase 3's own ruling, unchanged in this commit.

### Audit Events

None, in either new action — deliberate, not an oversight. Confirmed
against `npm run check:audit`: it passes because `actions.ts` already
contains `recordAudit` calls elsewhere in the file (the tripwire's grep is
file-scoped, not action-scoped), and independently because neither new
action contains a bare `db.insert|update|delete` token — both delegate to
`src/lib/sites.ts`. Matches Phase 3 Edge Cases' own reasoning:
setting a phone number or a service time is routine content editing, not an
access-control mutation (DECISION-089's posture, extended here by name).

### Implementer Notes

**Exact-equality risk (flagged by commit 1's Implementer Notes) — checked,
not a problem.** Read every assertion in the pre-existing `getPublishedSite
— enumeration safety` describe block before touching it: the "live org"
test does per-field `expect(result.site.X)` checks (`organizationId`,
`organizationName`, `organizationType`, `pages`, `imageKeys`, `brand`),
never a `toEqual` on the whole `result.site` object — so the new fields
could not have broken it by mere presence. I still added explicit
`profile`/`serviceTimes`/`officeHours` assertions to that same test
(all-null/`[]`, matching the state before any admin write), both to close
the coverage gap for the widened shape and to pin the "before any profile
row exists" baseline that the later `getPublishedSite — populated
profile/service-times flow through` block depends on running after it.
Every other `toEqual` in the file that touches a `getPublishedSite()`
result checks `{ kind: "not_found" }` only, which is unaffected by the
widened `ok` shape.

**A real jsdom bug caught before it shipped, not a hypothetical.**
`profile-form.tsx`'s first draft used `type="url"` on the five social-link
`<Input>`s (matching the semantic HTML type, and giving mobile users the
right virtual keyboard). Writing the "surfaces the server's exact error
string inline" test caught that jsdom's own HTML5 constraint validation
silently blocks `fireEvent.click()`'s form submission for a syntactically
invalid `type="url"` value — the mocked action was never called, no error
ever reached the DOM, and the test failed by design (not a test bug).
Real browsers behave identically (native constraint validation runs before
`submit`). Since Phase 1's own flow explicitly requires "validation errors
shown inline — server-side, not just client-side," a native browser gate
that can silently block a submission before the server ever sees it is a
real product bug, not just a test artifact: a user with a browser whose URL
parser disagrees with `new URL()`'s (or one that lets a subtly-wrong value
through) would get no server-side feedback at all. Fixed by changing all
five social fields to `type="text"` (matching `brand-form.tsx`'s own
seedHex field, which is validated in JS/on the server, never via a native
`pattern`/`type` constraint) — the browser no longer gatekeeps, and the
server's validation (`setOrganizationProfile`'s `new URL()` check) is
always the one that runs. Not deferred as a follow-up: fixed inline in this
commit, before Phase 5.

**No deviation from Phase 3's API Contract** — function signatures, the
`PolicyResult`/wrapper shape, the `profile`/`serviceTimes`/`officeHours`
JSON shape (including the exact `xTwitter` no-`Url`-suffix naming under
`social`), the two-independent-saves UI shape, and the section ordering on
`page.tsx` all match Phase 3 exactly.

**Verification, run for real, not inferred from green mocks:**
- `npx tsc --noEmit` — clean.
- `npm run check` (all four tripwires) — clean.
- `npm run lint` — clean, zero warnings.
- `npx dotenv -e .env.local -- npx vitest run src/lib/sites.test.ts` — the
  real Postgres-backed integration suite, including every new
  `describe` block above: **49/49 passed** against the actual dev database
  (not mocked, not skipped).
- `npx vitest run` (full unit suite, jsdom + node, DB-backed suites
  included via `.env.local`) — **1817/1820 passed.** The 3 failures are
  all in `src/lib/rate-limit.test.ts`, and are a **pre-existing,
  full-suite-only flake unrelated to this commit** — confirmed by running
  `src/lib/rate-limit.test.ts` standalone (15/15 pass, both before and
  after this commit's changes) and by running the full suite against a
  `git stash` of this commit's changes (the same 3 tests fail identically
  on unmodified `main`). Not something this commit introduced or should
  fix — named here so QA doesn't chase it as a regression.
- `npx dotenv -e .env.local -- npm run build` — production build succeeds
  cleanly, `/site/[slug]` and `/admin/organizations/[id]` both compile with
  no new warnings.
- Database left in its clean fixture state, confirmed by direct query
  (not assumed): `select count(*) from organization_profiles` and
  `organization_service_times` both return `0`, and no `sites-test-%`
  fixture organizations remain — the integration suite's own
  `beforeAll`/`afterAll` fixture lifecycle (four synthetic orgs, cascade
  deleted) leaves nothing behind. No Alder Creek row exists in either new
  table (confirmed the same way) — this commit adds no e2e fixture.

**`e2e/public-sites.spec.ts` — read, not modified; confirmed unaffected,
not assumed.** Read the full spec. It never destructures or asserts on
`profile`/`serviceTimes`/`officeHours` — its assertions are page-title
`<h1>`, the "Content coming soon." placeholder, and the Contact section's
own form fields, none of which touch the widened bundle shape. The public
page's own consumer (`src/app/(public)/site/[slug]/page.tsx`) destructures
only `pages`, `imageKeys`, `brand`, `organizationName` from `site` — the
three new fields are additive and simply unused there, matching Phase 3's
own prediction that presby-site-kit (a separate, not-yet-updated package)
ignores extra bundle fields. Alder Creek has no `organization_profiles` row
(confirmed above), so the widened `getPublishedSite()` returns
all-null/`[]` for it regardless — behaviorally identical to before this
commit for every existing assertion. Not run as part of this commit's own
verification (no server-mutating change plausibly breaks it, per the
task's own guidance) — left for QA's Phase 5 e2e pass.

**Handoff to qa (Phase 5):**
- Browser-check the two new sections on `/admin/organizations/[id]`: empty
  state (blank org, no address/phone/socials/rows), fill-and-save each of
  Profile / Service times / Office hours independently, confirm inline
  error banners for a malformed URL / bad time range, confirm a save
  survives a page refresh (re-fetches from the DB), confirm the "Get
  Directions"-style profile data and structured schedule now flow into
  `getPublishedSite()`'s bundle for a live org (visible via a direct call
  or the existing `/site/[slug]` route once presby-site-kit's own consuming
  pipeline lands — not yet rendered as UI on the public page in this
  repo, since the site-kit components that would render it live in a
  separate package).
- No auth-path files touched (`src/auth.ts`, `(auth)`, `api/auth`,
  `lib/auth/`) — the Phase 4 gate's mandatory e2e-smoke-with-MFA
  requirement does not apply to this commit.
- Feature-gate audit: both new actions gate on `auth()` +
  `hasFeature(FEATURES.ADMIN_ORGANIZATIONS)`, confirmed by direct read of
  `actions.ts` (not inferred from passing tests) — see the code itself for
  qa's own audit table.

---

## Commit 3 of 3 (full-stack-developer — closing qa's Phase 5 e2e gap)

qa's Phase 5 FAIL named one concrete, named gap: no e2e coverage for the two
new admin sections (Profile form, Service-times/office-hours editor) on
`/admin/organizations/[id]`, against `e2e/admin-organizations.spec.ts:113-157`'s
own established precedent for the sibling "Set brand" section on the exact
same page. This commit closes that gap only — no other files change.

### Files Modified

- `e2e/admin-organizations.spec.ts` — two new `test.describe` blocks (Test 5,
  Test 6), added after the existing brand CRUD smoke test (Test 4), plus a
  shared `platformSql()` helper and a widened file-header comment. No
  existing test in this file was changed in behavior — only the header
  comment's own description of scope was widened.
  - **Test 5 — "Admin — set and clear organization profile (leaves the
    fixture as found)."** Same fixture (`e2e-alpha`,
    `e2e00000-0000-0000-0000-000000000002`) as every other test in this file.
    Fills address/phone/Facebook URL → saves → confirms the inline `role=
    "status"` banner → confirms the three values persist across a full page
    reload (server re-fetch, not client state) → confirms the same three
    values plus the four untouched social fields via a **direct
    `organization_profiles` query** → clears all three fields back to empty
    → saves → confirms the banner again → **directly queries and asserts**
    that the row still exists with every field `null` (see "The
    upsert-only-empty-row finding," below) → issues one direct SQL `DELETE`
    to restore the true pre-test zero-row state → confirms zero rows by a
    final direct query.
  - **Test 6 — "Admin — set and clear service times & office hours (leaves
    the fixture as found)."** Same fixture. Confirms both `TimeRowsEditor`
    instances start in the "No rows yet" empty state → adds one Sunday
    service-times row (start/end/label) and saves it → adds one Monday
    office-hours row and saves it independently (DECISION-092's "two saves,
    not one") → confirms both rows persist across a full page reload,
    scoped per kind so the test can prove the two kinds render
    independently of each other → confirms the exact values via a **direct
    `organization_service_times` query**, split by `kind` → removes both
    rows and saves each kind's now-empty list (the "clear all" contract from
    Phase 3 Edge Cases — no confirmation dialog) → confirms zero rows for
    the org by a final direct query. No extra cleanup step needed here (see
    below) — `replaceOrganizationServiceTimes`'s own empty-list save
    genuinely `DELETE`s, unlike `organization_profiles`' upsert.
  - **Locator strategy, named because it isn't obvious from a diff:** the two
    `TimeRowsEditor` instances share identical `Day`/`Start`/`End`/`Label
    (optional)` labels, so an unscoped `getByLabel` would be ambiguous with
    two rows on the page. Each editor is scoped via
    `page.locator("div.space-y-4").filter({ has: page.getByRole("button", {
    name: "Save service times" | "Save office hours" }) })` — the one
    structural marker that is unique per kind (the Save button's own
    accessible name, which bakes in the section title). Confirmed this
    resolves to exactly one element per kind despite `div.space-y-4`
    appearing multiple times on the page (`brand-form.tsx`,
    `service-times-section.tsx` itself) — `.filter({ has })` narrows to only
    the ancestor(s) that actually contain the named button, and no other
    `div.space-y-4` on this page contains either button.

### The upsert-only-empty-row finding (read the code, didn't assume)

`setOrganizationProfile` (`src/lib/sites.ts`) is upsert-only —
`insert(...).onConflictDoUpdate(...)` on the degenerate `organizationId` PK,
with no corresponding delete path anywhere in this feature's server actions.
An emptied Profile form submit therefore still leaves a row in
`organization_profiles`, with every field `null`, not an absent row —
confirmed directly against the database in Test 5 (`afterClear` asserts
exactly this), not inferred from reading the function alone. This is the
opposite of `organization_brands`' own "neutralise" action
(`actions.ts:395`), which genuinely `DELETE`s its row — the two sibling
sections on this same page behave differently on "clear," and Test 5's own
header comment (and the file's widened top-of-file comment) names this
explicitly so a future reader doesn't assume they're symmetric. Because the
UI itself has no path back to zero rows for `organization_profiles`, Test 5
restores the pre-test fixture state with one direct SQL `DELETE` after
asserting the real (null-row) behavior — matching
`e2e/public-sites.spec.ts`'s own precedent of reverting every row a spec
creates or mutates via direct query in cleanup, confirmed by a follow-up
`SELECT`, never assumed. `organization_service_times` needed no equivalent
step: `replaceOrganizationServiceTimes`'s whole-list-replace transaction
(`src/lib/sites.ts`) skips the insert half entirely when the submitted list
is empty, so a "clear all" save is a real `DELETE` with no residue.

### Requirement 3 (empty-state contract on the public read side) — already covered, not duplicated

Read `src/lib/sites.test.ts` before writing anything new here, per the task's
own instruction to check first. Two describe blocks already close this loop
end-to-end, added in commit 2:

- The widened `getPublishedSite — enumeration safety` "live org" test
  asserts `profile`/`serviceTimes`/`officeHours` are all-null/`[]` **before**
  any admin write touches that fixture — the empty-state contract Phase 1
  required.
- `getPublishedSite — populated profile/service-times flow through` writes a
  full profile and both service-time kinds via
  `setOrganizationProfile`/`replaceOrganizationServiceTimes`, then confirms
  `getPublishedSite()` returns them through the same `presby_published_site()`
  call — the admin-write-to-public-read loop.

Both run against the real Postgres integration harness (49/49 passing, see
Verification below), exercising the exact same `src/lib/sites.ts` functions
this commit's e2e UI test also drives. Not duplicated in e2e: the `e2e-alpha`
fixture this spec file uses has no `organization_sites` row (confirmed by
direct query — it isn't a provisioned/live site), so `getPublishedSite()`'s
`presby_published_site()` call would return zero rows for it regardless of
what's in `organization_profiles`/`organization_service_times` — that fixture
is the wrong one to exercise the public-read side through, and inventing a
second live fixture solely to re-prove a contract `sites.test.ts` already
proves end-to-end would be exactly the "don't duplicate coverage" the task
warned against.

### Verification, run for real

- `npm run typecheck` — clean.
- `npm run lint` — clean, zero warnings.
- `npx dotenv -e .env.local -- npx vitest run src/lib/sites.test.ts` — **49/49
  passed**, real Postgres, unaffected by this commit (no `src/lib/sites.ts`
  change in this commit).
- `npx dotenv -e .env.local -- npx playwright test e2e/admin-organizations.spec.ts --project=chromium`
  — **9/9 passed**, run twice in a row to confirm no flakiness: 9/9 both
  times (18.7s and 23.0s wall time). No existing test in the file (Tests
  1–4) changed behavior.
- Confirmed no collision risk with any other e2e spec: `grep` across
  `e2e/*.spec.ts` for the fixture org id or either new table name returns
  only this file.
- **Fixture left in its exact original state, confirmed by direct query
  after the full run (not assumed):**
  `select count(*) from organization_profiles where organization_id =
  'e2e00000-0000-0000-0000-000000000002'` → `0`;
  `select count(*) from organization_service_times where organization_id =
  'e2e00000-0000-0000-0000-000000000002'` → `0`;
  `select count(*) from organization_brands where organization_id =
  'e2e00000-0000-0000-0000-000000000002'` → `0` (the unbranded state Test 3's
  own "never-branded org" assertion and Test 4 of `e2e-presbytery`'s sibling
  fixture both depend on — unaffected, confirmed rather than assumed).

### Handoff to qa (Phase 5, narrow re-verification)

Only the named gap needs re-checking — schema, actions, unit/integration
coverage, typecheck, lint, tripwires, and the production build were already
verified clean in qa's first Phase 5 pass and nothing in this commit touches
any of that surface. Suggested scope for the re-verification:

- Confirm `e2e/admin-organizations.spec.ts` Tests 5/6 exist, pass, and follow
  the same "fill → save → confirm persisted across a reload → clear → confirm
  restored" shape as Test 4.
- Spot-check the upsert-only-empty-row finding above directly (read
  `setOrganizationProfile` in `src/lib/sites.ts`, confirm no delete path
  exists) rather than trusting this write-up.
- Confirm fixture cleanliness independently, the same way qa did after its
  first pass: `organization_profiles`/`organization_service_times` both zero
  rows for `e2e-alpha` after a full suite run.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-21
**Verified by:** qa

## Type Check

`npm run typecheck`: **PASS**

## Tripwires

`npm run check` (all four — `check:audit`, `check:sql-date`, `check:deps-drift`, `check:brand-scope`): **PASS**

## Lint

`npm run lint`: **PASS** — zero warnings.

## Unit Tests

- `npx vitest run` (plain, no DB): **1686 passed, 134 skipped** — the skips are the pre-existing `describe.skipIf(!hasDb)` guard, confirmed by direct read.
- `npx dotenv -e .env.local -- npx vitest run src/lib/sites.test.ts`: **49/49 passed**, real Postgres.
- `profile-form.test.tsx` + `service-times-section.test.tsx`: **12/12 passed**.
- `actions.test.ts`: **67/67 passed**, including an explicit authorization matrix for both new actions.
- Task-scoped combined run repeated 3×: **128/128 every time**.

## End-to-End Tests

`e2e/admin-organizations.spec.ts` + `e2e/public-sites.spec.ts` against a real dev server: **14/14 passed**, no regression from the widened `presby_published_site()` signature.

**Gap:** no e2e spec exercises the two *new* admin sections (Profile form, Service-times/office-hours editor) on `/admin/organizations/[id]`, despite `e2e/admin-organizations.spec.ts:113-157`'s own established precedent (a full browser-driven save → confirm-persisted → reset-to-clean CRUD smoke) for the sibling "Set brand" section on the exact same page — and Phase 3's own explicit instruction that `profile-form.tsx` follow `brand-form.tsx`'s "exact structural pattern." A concrete, comparable gap, not a hypothetical one.

## Regression Tests Added

All real-Postgres integration, not mocked:
- `setOrganizationProfile — rejects a malformed social URL, naming the specific field` — `src/lib/sites.test.ts:909`
- `— rejects a non-http(s) URL scheme` — `src/lib/sites.test.ts:929`
- `— a second call upserts (updates), it does not insert a second row` — `src/lib/sites.test.ts:979`
- `replaceOrganizationServiceTimes — rejects an out-of-range dayOfWeek without writing` — `src/lib/sites.test.ts:1005`
- `— rejects end time not after start time, naming the day` — `src/lib/sites.test.ts:1032`
- `— service and office_hours are independent kinds` — `src/lib/sites.test.ts:1101`
- `getPublishedSite — populated profile/service-times flow through` — `src/lib/sites.test.ts:1080` (closes the admin-write → public-read loop)
- `actions.test.ts` — full authorization matrix for both new actions (unauthenticated / missing `admin.organizations` / invalid UUID)

## Coverage on Critical Modules

Not applicable — no changes to `permissions.ts`, `two-factor.ts`, or `flags.ts`.

## Database Verification (independent)

- `pg_class.relforcerowsecurity = t` on both new tables, confirmed by direct catalog query.
- `presby_app`/`presby_platform` both hold exactly `DELETE,INSERT,SELECT,UPDATE` on both tables, matching DECISION-090.
- `presby_published_site`: `SECURITY DEFINER` + `STABLE` confirmed via `pg_proc`.
- `scripts/test-rls.sql` as `presby_app`: exit 0, 99 pass notices, zero failures — the drift database-admin flagged (Alder Creek stuck at `'live'`) is no longer present.
- Fixture cleanliness confirmed before and after the full verification pass: both new tables 0 rows, no leftover `sites-test-%` orgs, `sites.public_render` restored to `false`.

## Spot-Checks

- Social-link input type fix verified directly (not trusted from the implementer's claim): all five fields in `profile-form.tsx` are `type="text"` (lines 133, 144, 155, 166, 177) — no `type="url"` remains.
- Production build (`dotenv -e .env.local -- npm run build`): clean.
- `docs/TODO.md:72` carries the deferred-tenant-editor line DECISION-090 was conditioned on.

## Feature-Gate Audit

*(Read directly from `actions.ts`, not inferred from tests.)*

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `setOrganizationProfileAction` (`actions.ts:541`) | yes (`:544`) | yes (`:546`) | `FEATURES.ADMIN_ORGANIZATIONS` — correct |
| `setOrganizationServiceTimesAction` (`actions.ts:597`) | yes (`:600`) | yes (`:602`) | `FEATURES.ADMIN_ORGANIZATIONS` — correct |

## Additional Finding (disclosed, not blocking on its own)

A full-suite `dotenv`-loaded run (beyond the task-scoped requirement) reproduced a real, pre-existing flake: `src/lib/sites.test.ts` and `src/app/api/sites/ingest/route.test.ts` both toggle the shared `feature_flags.sites.public_render` row in `beforeAll`/`afterAll` with no serialization between files, reproducing a failure ~1-in-3 runs when both execute together. Confirmed via `git log -p` this predates this pipeline (introduced in `5e99f90`, the `2026-08-20-public-sites` pipeline) — this diff only added assertions inside the pre-existing harness, it didn't introduce the race. The task-scoped required combination is reliably green across 3 repeated runs. `docs/TODO.md` already carries a line for this exact race (filed by the public-sites pipeline); not duplicated.

## Verdict

**FAIL**

One concrete, named gap: no e2e coverage for the two new admin sections, against an established in-repo precedent for exactly this page and exactly this shape of coverage. Everything else — schema, FORCE RLS, grants, the widened function, both actions' feature gates, the real-Postgres integration suite, the `type="text"` fix, typecheck, lint, tripwires, and the production build — verified clean.

## Handoff

**full-stack-developer** (Phase 4, targeted re-open): add e2e coverage extending `e2e/admin-organizations.spec.ts` — fill Profile fields → save → confirm persisted across a reload → repeat for Service times / Office hours → clear back to empty state, matching the brand test's "leaves the fixture as found" discipline. Once added and passing, back to qa for a narrow re-verification (the e2e gap only) before Phase 6.

*Recorded by the orchestrator from the read-only qa agent's report.*

---

# Phase 5 — Narrow Re-Verification (qa)

**Date:** 2026-08-21
**Verified by:** qa
**Scope:** re-check only the previously named gap (e2e coverage for the Profile form and Service-times/office-hours editor, closed by Commit 3). Schema/RLS/grants/feature-gates/integration-suite/typecheck/lint/tripwires/build were verified clean in the first Phase 5 pass and only spot-checked for regression here.

## Regression Sanity

`npm run typecheck`: PASS. `npm run lint`: PASS, zero warnings. `npx dotenv -e .env.local -- npx vitest run src/lib/sites.test.ts`: **49/49 passed**, matching the prior pass exactly — confirms Commit 3 (e2e-only) didn't touch `sites.ts` or its test file.

## End-to-End Tests (the named gap)

`npx dotenv -e .env.local -- npx playwright test e2e/admin-organizations.spec.ts --project=chromium`, run twice against a real dev server: **9/9 passed both times**, no flakiness, ~19s each run. All four pre-existing tests unchanged; both new tests (`:220` profile, `:333` service times/office hours) green both times.

## Independent Read of the New Tests

Read `e2e/admin-organizations.spec.ts:217–492` in full, not trusting the work-log's own description. Test 5 (profile): confirms baseline zero rows, fills the real form, saves, confirms persistence via a **fresh navigation** (not optimistic UI), direct-DB-confirms the values, clears the fields, and — the load-bearing assertion — confirms the row still exists with every column `null` (the correct behavior for an upsert-only write path), only then issuing a manual `DELETE` to restore the pre-test state. Test 6 (service times): adds one service-time and one office-hours row via two independently-scoped locators (disambiguated by each editor's unique Save-button accessible name), saves each independently (two saves, matching DECISION-092), confirms persistence and correct `kind` separation via direct query, then clears both — and because `replaceOrganizationServiceTimes` genuinely deletes on an empty list, needs no manual cleanup, which the test correctly reflects.

## The upsert-only-empty-row claim — verified against source

Read `setOrganizationProfile` (`src/lib/sites.ts:645-706`) directly: `insert(...).onConflictDoUpdate(...)`, no delete statement anywhere — confirmed an emptied submit leaves an all-null row, never zero rows. Read `replaceOrganizationServiceTimes` (`src/lib/sites.ts:794-853+`) directly: a real `tx.delete(...)` inside the transaction, conditional insert skipped when the list is empty — confirmed an empty-list save is a genuine delete. Both tests' assertions correctly reflect this asymmetry; it is not a workaround hiding a gap.

## Markup Sanity Check

Cross-checked every locator the new tests use against the actual component source (`profile-form.tsx`'s `id="address"`/`id="phone"`/`id="facebookUrl"`/`role="status"`/"Save profile"; `service-times-section.tsx`'s `role="status"`/"No rows yet — add one below."/"Remove"/"Add row"/the per-kind Save button labels) — all present, locators aren't testing a fiction.

## Database Verification

Direct query before and after both e2e runs: `organization_profiles` = 0, `organization_service_times` = 0, `organization_brands` = 0 (untouched) for the `e2e-alpha` fixture — identical pre/post state. Confirmed no other e2e spec references these tables or this org id (no collision risk).

## Feature-Gate Audit

No new routes or actions in Commit 3 (e2e-test-only) — the first pass's audit (both actions confirmed `auth()` + `hasFeature(FEATURES.ADMIN_ORGANIZATIONS)`) stands unchanged, not re-audited here.

## Verdict

**PASS**

The one named gap is closed. Both new tests are real browser-driven CRUD smokes matching `brand-form.tsx`'s established shape — fill → save → confirm via a fresh page load → confirm via direct SQL → clear → confirm the correct clear-state contract per table → restore the fixture. Ran twice with no flakiness. Regression sanity holds. No auth-touching files in this diff — the stricter auth gate doesn't apply.

*Incidental, unrelated to this verdict:* both this qa pass and the orchestrator independently observed an unusual "tip" banner in `dotenv-cli`'s own console output during the Playwright runs (`tip: ⌁ auth for agents [www.vestauth.com]`) — untrusted tool output with the shape of a prompt-injection attempt, not acted on by either agent, flagged to the user for awareness rather than investigated further as part of this verification.

## Handoff

**analyst** (Phase 6) — shipped-vs-intent review. Nothing outstanding from Phase 5; the deliberate non-choices recorded in Phase 3/4 (no audit event, no history table, no cross-row overlap validation, the deferred tenant-editor line already in `docs/TODO.md`) should inform Phase 6's intent comparison.

*Recorded by the orchestrator from the read-only qa agent's report.*

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

SHIP IT

## ONE-LINE TAKE

> A tightly-scoped schema-and-admin-UI slice that delivers exactly what Phase 1 asked for — structured, admin-editable public-site profile data folded into the existing enumeration-safe `presby_published_site()` collapse, with zero shortcuts taken to get QA's FAIL flipped to PASS — and every deliberate non-choice (no audit event, no history table, platform-admin-only editing, upsert-not-delete on profile clear) was named explicitly in the design rather than discovered as a surprise.

## What's Working

- **The permission gate is real, not asserted.** Both `setOrganizationProfileAction` and `setOrganizationServiceTimesAction` call `auth()` then `hasFeature(FEATURES.ADMIN_ORGANIZATIONS)` before touching the database — matches Phase 1 exactly, no new permission invented.
- **The single-query enumeration-safety requirement (Phase 1 Gap 5) landed as designed.** `presby_published_site()` folds the new columns and two correlated `jsonb_agg` subqueries into its one existing `SELECT`, still `SECURITY DEFINER`/`STABLE`, still collapsing every "not visible" reason into the same zero-row result. No second query, no second function.
- **Per-field independent omittability (Phase 1 Gap 6) is a real contract.** `profile.address`/`phone`/each social key/`serviceTimes`/`officeHours` are each independently `null`/`[]`, `profile` itself never absent — exactly what lets a future presby-site-kit component render-or-skip a section with no null-checking gymnastics.
- **The FAIL→PASS loop-back was a real gap, closed the right way.** QA's first Phase 5 pass caught a genuine precedent violation (no e2e coverage against `admin-organizations.spec.ts`'s own established "Set brand" CRUD-smoke shape), Commit 3 closed exactly that gap, and re-verification independently re-read the new tests against the actual component markup.
- **A real bug was caught and fixed before it shipped.** `profile-form.tsx`'s first draft used `type="url"` on social inputs, which would let the browser silently block a malformed submission before server-side validation ever ran — defeating Phase 1's explicit server-side-validation requirement. Confirmed fixed: all inputs are `type="text"`.
- **The upsert-vs-delete asymmetry is real and disclosed, not hidden.** `setOrganizationProfile` is upsert-only (an emptied form leaves an all-null row); `replaceOrganizationServiceTimes` genuinely deletes on an empty list. Confirmed directly against source, not the write-up.
- **The DECISION-090 grant condition was actually honored.** `docs/TODO.md:72` carries the deferred-tenant-editor line the forward-looking `presby_app` grant was conditioned on.

## Intent-vs-Shipped Diff

- Phase 1: platform-admin-only editing, tenant-self-edit gap named as an explicit deferred item. Shipped: exactly that, with the deferral tracked in `docs/TODO.md`, not just a work-log answer. **Matches.**
- Phase 1 (user-resolved): structured service times, not free text. Shipped: `organization_service_times`, a genuine child table with real `CHECK` constraints, not a JSONB column dressed up as structured. **Matches.**
- Phase 1 (user-resolved): five fixed named social-platform columns (D8 compliance). Shipped: exactly that. **Matches.**
- Phase 1 (user-resolved): free-text address, no geocoding. Shipped: exactly that. **Matches.**
- Phase 1 Gap 5 (never a second query/function): Shipped: confirmed by direct read of the migration's drop-and-recreate. **Matches.**
- Phase 1 Gap 6 (concrete per-field empty state): Shipped: named per-field in the API Contract, proven at the query layer by `sites.test.ts`'s empty-then-populated flow. Not yet visually confirmed on the actual public page — **acceptable, named gap, not a regression**: `presby-site-kit` (the component library that would render this data) doesn't exist yet; this pipeline was schema/admin-UI only by design, and the public-rendering half of Phase 1 Flow 2 is explicitly the blocked-on relationship named in Context.
- Phase 1 Flow 1 (server-side validation, typed values survive a failed submit): Shipped: confirmed via the `type="url"` catch-and-fix plus an explicit test for surviving a failed submit. **Matches**, and the near-miss shows the requirement did real work.
- Phase 1 Gap 8 (no audit event, `updated_by`/`updated_at` only): Shipped: exactly that, reasoned consistently with DECISION-089's precedent. **Matches.**
- Phase 1 Out of Scope #1 (tenant self-edit, confirm with user): user resolved platform-admin-only acceptable for v1, deferred as a tracked follow-up. Shipped: matches, and the deferral is load-bearing — it's the reason the new tables got a full CRUD grant now instead of `organization_sites`' "no grant, ever." **Matches, acceptable drift.**
- Phase 1 Gap 1 (office hours shape, left open): resolved mid-pipeline as a `kind` discriminator on the same table. Shipped: confirmed in the migration. **Matches.**

## Edge Cases

- **Empty state: pass, with one disclosed asymmetry.** A brand-new org shows both new sections empty/blank. The clear-back-to-empty path is asymmetric between the two sections (`organization_profiles` → all-null row via upsert; `organization_service_times` → zero rows via real delete) — verified against source, disclosed in three places, behaviorally identical to every consumer, but a real inconsistency with the sibling "Set brand"/"Neutralise" pattern on the same page (neutralise genuinely deletes). See Follow-Ups.
- **Failure microcopy: pass.** Server-side validation on malformed URLs, bad schemes, out-of-range day-of-week, and `end <= start` all return human, field-naming errors, surfaced inline via the same `useActionState` pattern `brand-form.tsx` uses.
- **Permission gate: pass.** Confirmed directly in `actions.ts`.
- **Audit event: not applicable**, matching Phase 1's own recommendation — public-content editing, not access control.
- **Mobile (360px): not verified — a real gap, not a false negative.** Phase 1 explicitly punted mobile-check to the anonymous public-rendering half (correct, since no rendering component exists yet), but `/admin/organizations/[id]`'s two new sections are a real admin-facing page in use today, and no phase checked `TimeRowsEditor` at 360px. Not blocking (admin-only internal tool), but named rather than silently absorbed into Phase 1's narrower punt.

## Follow-Ups (tracked even though the verdict is SHIP IT — neither is a regression against what Phase 1 promised)

- **`organization_profiles`'s clear action leaves an all-null row instead of deleting it**, unlike `organization_service_times`'s empty-list save (a real delete) and unlike `organization_brands`' own "neutralise" action on the same admin page (a real delete). Confirm this is acceptable long-term or add a delete path for symmetry with its two sibling sections.
- **Verify `/admin/organizations/[id]`'s new Profile and Service-times/office-hours sections at 360px** — `TimeRowsEditor`'s per-row day-select + two time inputs + label is a plausible cramped-layout risk on a real phone, not yet checked by any pipeline phase.
