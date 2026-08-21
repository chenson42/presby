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
| 4 — Implementation | database-admin (schema), full-stack-developer (query/actions/UI) | Commit 1 (schema) complete, commit 2 (query/actions/UI) pending | — | 2026-08-21 |
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

**Commit 1 of 2 (database-admin, schema only).** Commit 2 (query layer, server actions, admin UI — full-stack-developer) is not started; this section covers commit 1 only, per the Implementer split named in Phase 3.

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
