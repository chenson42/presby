# Careers, Increment 1: postings and the public read — Work Log

> **Slug:** `2026-10-25-careers-inc1`
> **Parent:** `docs/work-log/2026-10-25-careers.md` (shared Phase 1 and Phase 2 live there, verbatim; this file does not repeat them)
> **Surface:** mixed — public site (`(public)/site/[slug]`, platform host and custom host) and `(org)` staff admin
> **Permission(s):** `careers.manage` (tier 1, used at runtime from this increment); `careers.applicants` (tier 3, cataloged, bundled and templated here, checked by no code until Increment 2)
> **Flag(s):** none (per-org toggle `org_portal.careers`, operator rule)
> **Estimated complexity:** large
> **Pipeline mode:** Full
> **Numbers (pre-assigned, Rule 16):** migration 0071; DECISION-264/265/266 apply here (262 and 263 are Increment 2's); dev port 3580; Neon branch created at Phase 4 from `development`, never from production.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (parent log) | READY WITH NOTES | 2026-10-25 |
| 2 — Architectural review | architect | Complete (parent log) | Approved with suggestions | 2026-10-25 |
| 3 — Technical design | tech-lead | Complete for Increment 1 | Design complete; implementers named | 2026-10-25 |
| 4 — Implementation | database-admin, then api-developer, then ux-developer | Batch 1 (database-admin) complete, `dcbb94a`; Batch 2 (api-developer) complete, `755cc8b`..`d69b6b2`; Batch 3 (ux-developer) complete, `2da6bdf`..`5ab2e0d` and the commit recording this section | — | 2026-10-25 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 3 — Technical Design (tech-lead)

Design date 2026-10-25. Designed against the live tree of `pipeline/careers` at `b903154` (main as of v0.42.5). Main has since moved to `2a25584` (v0.43.0, the platform admin shell, 25 commits). I diffed the two for every file this design modifies (`audit.ts`, `org-features.ts`, `site-urls.ts`, `sites-reserved-paths.ts`, `render-site-page.tsx`, the cron route, `src/lib/onboarding/*`, `src/lib/org-portal/*`, the `(org)` and `(public)` trees, the ingest route, `e2e/support/*`, `scripts/*`, `drizzle/*`): no overlap. The only shared file is `CLAUDE.md`, which this design edits at ship time, not in Phase 4. Phase 4 merges main first and re-runs the feasibility list below.

Binding inputs: Phase 1 (G1–G14, Q1–Q12, Copy proposals), the operator rulings (redact in place and destroy file bytes; both careers keys join the founding-administrator bundle; PDF and .docx at 4 MB), Phase 2 (rulings, Invariants, Notes 1–8, F289–F295, DECISION-262–266, the three-increment split) and the orchestrator note (Increment 2's migration is 0075).

## Summary

A congregation (or presbytery, or synod) can post job openings on its public website. Staff holding the new `careers.manage` permission write an opening in a plain editor — a markdown textarea with a toolbar, a live preview, and a paste converter for Word and Google Docs — publish it, set a closing date, close and reopen it, and order the list. Visitors read the list at `/careers` (or wherever the site's author places the new `careers` live slot) and each opening at `/careers/<posting>`, on a church's platform address and on its own domain. Online applying does not exist in this increment: every open posting says how to contact the church instead. The feature is off until an administrator turns on the new per-organization toggle `org_portal.careers`. Everything anonymous is one `SECURITY DEFINER` function that always returns one row, projects named keys only, and collapses every non-serving reason to the same answer. Migration 0071 also delivers what the later increments depend on, so a hiring committee can be set up before applying opens: both permission keys, the founding-administrator bundle (SQL, TypeScript, parity golden and backfill together), a `hiring_committee` role template, and the first version of the daily sweep, which only auto-closes postings past their closing date.

## Decisions that differ from the Phase 1 or Phase 2 text (read first)

| # | Earlier text | This design | Why |
|---|---|---|---|
| D1 | Phase 2 G6: render with site-kit's `renderMarkdown` | Render with site-kit's exported `<Prose body=…>` component, which calls the same function | `renderMarkdown` is not exported. `presby-site-kit@4.0.0`'s `package.json` `exports` map has only `.` and `./styles.css`, and `dist/index.d.ts` re-exports no markdown symbol (read 2026-10-25). `Prose` is exported and is the same code path the bundle's own `prose` blocks use, so the "one renderer" intent of the ruling holds. Finding P3-1. |
| D2 | Phase 2 G8 / DECISION-264 leaves chrome open | `/careers` and `/careers/<posting>` are platform pages shaped like `/give`: the church's brand colours and fonts, a "Back to {church}" link, no site top menu or footer | site-kit's CSS is keyed on a `.presby-site` ancestor and is sized to the first customer's site (its prose `h2` is 4.25rem, 68px). A posting's `##` heading rendered inside site chrome would be 68px. A plain wrapper with its own typography avoids that. The `careers` slot, placed on a content page, is inside the chrome and renders cards only (no prose block), so it is unaffected. Finding P3-2. Operator question Q-A. |
| D3 | Phase 1: a closed posting "shows no longer accepting applications" | A closed posting's definer projection is `slug` and `title` only. The description, pay and dates never leave the database for a closed posting | Data minimisation by construction: a filled role's stale details cannot be served by a template bug. |
| D4 | Phase 1 Flow 1: off, not live and failed all show one notice. Phase 2 G8: otherwise `notFound()` | The slot (an author placed it) shows the one notice for off and for a failed read. The platform pages show the notice only for a failed read; a toggle-off or non-serving organization gets the site's one neutral 404 | Phase 2's rule wins for the platform pages: a toggle-off church must not publish a `/careers` page that says "unavailable". A blip must not 404 a real page, so a failed read is a notice with `noindex`. |
| D5 | Phase 2: `public.ts` reads through one definer | One definer, `presby_public_careers(p_slug, p_posting default null)`, answers both the list (`p_posting` null) and one posting. No separate gate function | One ACL, one gate composition, one test surface. |
| D6 | Phase 2 left the sweep's return type open | `presby_careers_sweep(p_limit)` returns `(kind, organization_id, posting_id, application_id)` from the start | Increment 2 re-creates the function with `create or replace`, which needs the same return type. |
| D7 | Phase 2: `hiring_committee` template | Inserted by key (`where not exists`), no fixed id | Template ids 1–6 are taken in the live tree; three pipelines are writing migrations, and a fixed id 7 is a collision waiting for the second merge. |
| D8 | Phase 1 G10 status line | Included, with four honest states, from a pure walker over the published bundle | The calendar pipeline deferred the equivalent because its line had to explain four causes. This one only reports what the bundle contains or says it could not check. |
| D9 | Phase 1: "Or call the office at {phone}" | "You can also call us at {phone}" | The profile phone is the organization's number, not necessarily the office's (source-of-truth check). |
| D10 | Phase 1 Pass 5: links get `rel="noopener noreferrer nofollow"` | Plain `<a href>` from `Prose` | No link opens a new tab, so `noopener` has nothing to protect, and the author is staff, not an applicant. `nofollow` is not available without a site-kit change. Accepted. |
| D11 | Architect Note 7 lists all documentation edits together | Split by what becomes true when | Project Layout lines and the bundle-residual sentence are true at Increment 1. The Never-Hard-Delete applicant exception and `docs/architecture.md` wait for Increment 2, which adds the delete path and the second binary store. |
| D12 | Not addressed | A posting is never deleted. A draft nobody wants is "discarded", which is a close | The operator's all-deletes-soft rule. |
| D13 | Not addressed | At most 100 published postings per organization, enforced in the database | The public list is capped at 100 rows; without the cap a 101st published posting would silently not appear. |

## Names

| Thing | Name |
|---|---|
| Migration | `drizzle/0071_presby_careers.sql` (hand-written; journal entry at integration) |
| Table | `job_postings` (Drizzle mirror `src/lib/db/domain/careers.ts`, `jobPostings`) |
| Permission keys | `careers.manage` (tier 1), `careers.applicants` (tier 3), module `careers` |
| Role template | key `hiring_committee`, name "Hiring Committee", `role_kind` `custom`, universal scope |
| Org toggle | `org_portal.careers`, category `people`, display name "Job openings" |
| Slot | `CAREERS_SLOT = "careers"` |
| Definers | `presby_public_careers(text, text default null)` (anonymous); `presby_careers_org_today(uuid)` (helper); `presby_careers_sweep(integer default 200)` (owner only) |
| Triggers | `job_postings_guard_insert`, `job_postings_guard_update`, `job_postings_guard_delete` |
| Audit keys | `CAREERS_POSTING_PUBLISHED: "careers.posting.published"`, `CAREERS_POSTING_CLOSED: "careers.posting.closed"`, `CAREERS_POSTING_REOPENED: "careers.posting.reopened"` |
| `SiteUrls` | `careers()`, `careersPosting(postingSlug)` |
| Lib module | `src/lib/careers/` (files listed under Component / Page Plan) |
| Shared components | `src/components/careers/` |
| Constants | `PUBLIC_POSTINGS_CAP = 100`, `MAX_PUBLISHED_PER_ORG = 100`, `DESCRIPTION_MAX = 20000`, `SUMMARY_MAX = 300`, `TITLE_MAX = 150`, `LOCATION_MAX = 200`, `SLUG_MAX = 80`, `STALE_AFTER_DAYS = 60` |
| RLS suite | `scripts/careers/test-rls-71.sql` |

## Permissions & Flags

- **Permission keys (tenant catalog, the `permissions` table; not `src/lib/permissions.ts`):** `careers.manage` (tier 1: postings are public content) and `careers.applicants` (tier 3, the operator-confirmed tier). `requires_two_factor` stays at its default `false` on both (Q3, matching the four existing tier-3 keys). Neither implies the other.
- **Runtime use in this increment:** only `careers.manage`. `careers.applicants` is checked by no code until Increment 2. A role that holds it can read nothing yet, and the Copy says so nowhere it would be false.
- **Default role bindings:** (1) both keys join the founding-administrator bundle in all three places the bundle exists: `presby_founding_administrator_permission_keys()` in SQL, `foundingAdministratorPlan()` in TypeScript, and the 0057-style backfill onto every org-owned `founding_administrator` role; (2) the new `hiring_committee` template carries both. Nothing else changes: `personnel_admin`, `staff.manage` and the stated-clerk templates are untouched, no wildcard role gains either key.
- **Why the key must be in the bundle:** `assertPermissionSubset()` makes a key nobody at an organization holds ungrantable there (F111). Without the bundle the template could never be adopted or granted.
- **Accepted residual (operator ruling Q4, `paper`):** the founding administrator can read applications (from Increment 2), detected by the audit row every resume download writes. Recorded in DECISION-265.
- **Org toggle:** one `ORG_FEATURE_CATALOG` entry, `org_portal.careers`: `category: "people"`, `flag: null`, `provisionedOn: false`, `orgTypes: null` (presbyteries and synods hire too), `operatorEnabled: false` (self-service). A missing row means off; `createOrganization()` writes nothing; no backfill. The existing `toggleOrgFeature()` already audits the flip. No off-warning (rollback is one click).
- **Platform flag:** none new (operator rule). `sites.public_render` is inherited because every public read starts at the site resolver. `org_portal.feature_categories` is read inside the definer and in `orgFeatureEnabledInTx`.
- **Order asked:** public side: site resolves live, then toggle (with the category axis), then the posting's own state. Staff side: session, `resolveOrgContext`, `assertOrgAccess`, then the toggle, then `careers.manage`, all inside one `withOrgContext` transaction in one gate helper that every lib function calls first (a mutation posted while the toggle is off is refused, not only hidden).
- **Permissions vs Flags:** a posting's status is data, not a permission and not a flag. Nothing here maps the form token or any credential into `FEATURES.*` (there is no form in this increment).

## API Contract

No new `/api` route. No Server Action outside `admin/careers/actions.ts`. The anonymous surface is two page routes and a live slot that read through one definer.

### SQL, in `drizzle/0071_presby_careers.sql`

**`presby_careers_org_today(p_org uuid) returns date`** — `language sql stable security definer set search_path = public, pg_temp`. The org's calendar date in `organization_settings.time_zone`, falling back to the literal `'America/New_York'` (pinned equal to `DEFAULT_ORG_TIME_ZONE` by test T6). `revoke all … from public, presby_platform; grant execute … to presby_app`. EXECUTE is granted to `presby_app` because the `job_postings` guard trigger (invoker) and the staff lib call it. Accepted disclosure: it answers a date derived from an organization's time zone, and answers the default-zone date for an unknown id, so it is not an existence oracle.

**`presby_public_careers(p_slug text, p_posting text default null)`**

```
returns table (state text, organization_name text, contact_phone text, org_today text,
               postings_json jsonb, posting_json jsonb)
language plpgsql stable security definer set search_path = public, pg_temp
```
EXECUTE revoked from `public, presby_app, presby_platform`, then granted to `presby_app` only. **Always exactly one row.** Meaning by `state`:

| `state` | When | Other columns |
|---|---|---|
| `unavailable` | unknown slug; organization not `active`; site not `live`; toggle row missing or off; category off while the axis flag is on. Byte-identical for every cause | all null |
| `available` | `p_posting` null; gate passed | `organization_name`, `contact_phone`, `org_today` (`YYYY-MM-DD`), `postings_json` (array, possibly empty, at most 100), `posting_json` null |
| `open` | `p_posting` given; found; `first_published_at` not null; `status = 'published'` and (no closing date or `closing_date >= org_today`) | `posting_json` has the 11 keys below; `postings_json` null |
| `closed` | found; `first_published_at` not null; `status = 'closed'` or published past its closing date | `posting_json` has `slug` and `title` only |
| `not_found` | gate passed but `p_posting` is malformed, unknown, in another organization, a draft, or a discarded draft (`first_published_at` null) | all null |

List and `open` posting keys, **exactly these**: `slug, title, location, employment_type, pay_min_cents, pay_max_cents, pay_unit, summary, posted_on, closing_date` (the last two as `YYYY-MM-DD` text, `check:sql-date`), plus `description_md` for `open` only. No id, no `organization_id`, no `created_by`, no `version`, no `status`, no `sort_order`, no timestamps. Order: `sort_order, posted_on desc, id`. A malformed `p_posting` (not `^[a-z0-9]+(-[a-z0-9]+)*$`, or over 80 characters) is `not_found` without querying.

Reference body (Phase 4 may restructure; the tests, not this text, are the contract). The gate composition is the part that must not drift:

```sql
drop function if exists presby_public_careers(text, text);
create function presby_public_careers(p_slug text, p_posting text default null)
returns table (state text, organization_name text, contact_phone text, org_today text,
               postings_json jsonb, posting_json jsonb)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  c_cap constant integer := 100;                    -- PUBLIC_POSTINGS_CAP
  v_org record; v_today date; v_axis_on boolean; v_cat_ok boolean; v_on boolean;
  v_phone text; v_json jsonb; r record;
begin
  select o.id, o.name, o.status into v_org from organizations o where o.slug = p_slug;
  if not found or v_org.status <> 'active'
     or not exists (select 1 from organization_sites s
                     where s.organization_id = v_org.id and s.status = 'live') then
    return query select 'unavailable'::text, null::text, null::text, null::text, null::jsonb, null::jsonb;
    return;
  end if;
  -- The toggle, composed exactly as orgFeatureEnabledInTx composes it (org-features.ts):
  -- orgTypes allow-list (null for this key: none here), then the category axis
  -- (flag row missing = axis off; category row missing = on), then the toggle (missing = off).
  v_axis_on := coalesce((select f.enabled from feature_flags f
                          where f.key = 'org_portal.feature_categories'), false);
  v_cat_ok  := (not v_axis_on) or coalesce((select c.enabled from organization_feature_categories c
                          where c.organization_id = v_org.id and c.category = 'people'), true);
  v_on      := v_cat_ok and coalesce((select t.enabled from organization_feature_toggles t
                          where t.organization_id = v_org.id
                            and t.feature_key = 'org_portal.careers'), false);
  if not v_on then
    return query select 'unavailable'::text, null::text, null::text, null::text, null::jsonb, null::jsonb;
    return;
  end if;
  v_today := presby_careers_org_today(v_org.id);
  v_phone := (select p.phone from organization_profiles p where p.organization_id = v_org.id);

  if p_posting is null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'slug', x.slug, 'title', x.title, 'location', x.location,
             'employment_type', x.employment_type, 'pay_min_cents', x.pay_min_cents,
             'pay_max_cents', x.pay_max_cents, 'pay_unit', x.pay_unit, 'summary', x.summary,
             'posted_on', to_char(x.posted_on, 'YYYY-MM-DD'),
             'closing_date', to_char(x.closing_date, 'YYYY-MM-DD'))
           order by x.sort_order, x.posted_on desc, x.id), '[]'::jsonb)
      into v_json
      from (select * from job_postings jp
             where jp.organization_id = v_org.id and jp.status = 'published'
               and (jp.closing_date is null or jp.closing_date >= v_today)
             order by jp.sort_order, jp.posted_on desc, jp.id
             limit c_cap) x;
    return query select 'available'::text, v_org.name, v_phone, to_char(v_today, 'YYYY-MM-DD'),
                        v_json, null::jsonb;
    return;
  end if;

  if char_length(p_posting) > 80 or p_posting !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    return query select 'not_found'::text, null::text, null::text, null::text, null::jsonb, null::jsonb;
    return;
  end if;
  select * into r from job_postings jp
   where jp.organization_id = v_org.id and jp.slug = p_posting and jp.first_published_at is not null;
  if not found then
    return query select 'not_found'::text, null::text, null::text, null::text, null::jsonb, null::jsonb;
    return;
  end if;
  if r.status = 'published' and (r.closing_date is null or r.closing_date >= v_today) then
    return query select 'open'::text, v_org.name, v_phone, to_char(v_today, 'YYYY-MM-DD'), null::jsonb,
      jsonb_build_object('slug', r.slug, 'title', r.title, 'location', r.location,
        'employment_type', r.employment_type, 'pay_min_cents', r.pay_min_cents,
        'pay_max_cents', r.pay_max_cents, 'pay_unit', r.pay_unit, 'summary', r.summary,
        'description_md', r.description_md,
        'posted_on', to_char(r.posted_on, 'YYYY-MM-DD'),
        'closing_date', to_char(r.closing_date, 'YYYY-MM-DD'));
  else
    return query select 'closed'::text, v_org.name, v_phone, to_char(v_today, 'YYYY-MM-DD'), null::jsonb,
      jsonb_build_object('slug', r.slug, 'title', r.title);
  end if;
end $$;
```

**`presby_careers_sweep(p_limit integer default 200)`** — `returns table (kind text, organization_id uuid, posting_id uuid, application_id uuid)`, `language plpgsql security definer set search_path = public, pg_temp`. EXECUTE **revoked from `public, presby_app, presby_platform`** and held by the owner only: a parameterless-in-spirit cross-org writer, the `presby_reconcile_current_roll()` precedent. In this increment it closes up to `least(greatest(p_limit,1),1000)` postings with `status = 'published'` and `closing_date < presby_careers_org_today(organization_id)`, oldest first, `for update skip locked`, and returns one `('posting_closed', org, posting, null)` row per posting closed. It ignores the toggle (retention clocks must never depend on a switch a church can flip). Increment 2 re-creates it with `create or replace` and adds redaction rows with `kind = 'application_redacted'`.

**`presby_founding_administrator_permission_keys(p_org_type text)`** — re-created with `create or replace`, same signature and return type, with `'careers.manage', 'careers.applicants'` appended after `'domains.manage'` (order matches the TypeScript array), then `revoke all … from public, presby_app, presby_platform` re-asserted.

### TypeScript, anonymous read (`src/lib/careers/`)

```ts
// contract.ts  (pure: no server-only, no database)
export const CAREERS_SLOT = "careers";
export const PUBLIC_POSTINGS_CAP = 100;
export type EmploymentType = "full_time" | "part_time" | "intern";
export type PayUnit = "hour" | "year";
export interface PublicPostingSummary {          // deliberately no id
  slug: string; title: string; location: string; employmentType: EmploymentType;
  payMinCents: number | null; payMaxCents: number | null; payUnit: PayUnit | null;
  summary: string; postedOn: string; closingDate: string | null;   // YYYY-MM-DD
}
export interface PublicPosting extends PublicPostingSummary { descriptionMd: string }
export type PublicCareers =
  | { state: "unavailable" } | { state: "failed" }
  | { state: "available"; organizationName: string; contactPhone: string | null;
      orgToday: string; postings: PublicPostingSummary[] };
export type PublicPostingRead =
  | { state: "unavailable" } | { state: "failed" } | { state: "not_found" }
  | { state: "open"; organizationName: string; contactPhone: string | null; posting: PublicPosting }
  | { state: "closed"; organizationName: string; contactPhone: string | null;
      slug: string; title: string };
export function employmentTypeLabel(t: EmploymentType): string;   // Full-time / Part-time / Intern
export function formatPay(min: number|null, max: number|null, unit: PayUnit|null): string | null;

// public.ts  (import "server-only")
export const readPublicCareers: (slug: string) => Promise<PublicCareers>;                     // React cache()
export const readPublicPosting: (slug: string, posting: string) => Promise<PublicPostingRead>; // React cache()
export function mapPublicCareersRow(row: Record<string, unknown> | undefined): PublicCareers;
export function mapPublicPostingRow(row: Record<string, unknown> | undefined): PublicPostingRead;
```

Reader rules: a slug failing `parseSiteKey(slug).kind === "slug"` returns `unavailable` without touching the database. The body is **one** `try/catch` around one `db.execute` of ``select * from presby_public_careers(${slug}::text, ${posting}::text)`` on the anonymous `db` (never `getPlatformDb()`). The catch logs `[public-careers] read failed` with `{ slug }` only (never the error or its message) and returns `{ state: "failed" }`, which is **not** `unavailable`: the platform pages show a notice for `failed` and a 404 for `unavailable` (D4), while the slot shows the same notice for both. The mappers narrow every field; a malformed row, a `postings_json` that is not an array (the driver parses jsonb), more than 100 entries, an unknown `employment_type` or `pay_unit`, a non-`YYYY-MM-DD` date or a missing key maps to `failed`, never to an empty list. No `unstable_cache` or `"use cache"`: freshness rests on the `force-dynamic` site layout.

### Staff lib (`src/lib/careers/postings.ts`, `import "server-only"`)

Every function runs inside one `withOrgContext` transaction and calls the gate first: toggle (`orgFeatureEnabledInTx` with the category axis, flag read once outside the transaction as `org-features.ts` does), then `presby_has_permission(person, org, 'careers.manage')`.

```ts
export interface CareersActor { userId: string; email: string | null }
export type PostingStatus = "draft" | "published" | "closed";
export interface PostingRow {
  id: string; slug: string; title: string; summary: string; location: string;
  employmentType: EmploymentType; payMinCents: number | null; payMaxCents: number | null;
  payUnit: PayUnit | null; descriptionMd: string; closingDate: string | null;
  status: PostingStatus; sortOrder: number; version: number;
  postedOn: string | null; firstPublishedAt: string | null; closedAt: string | null; updatedAt: string;
  /** What visitors see: published, and no closing date or closing date >= org today. */
  visibleToPublic: boolean;
}
export type CareersResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "feature_off"; canManageFeatures: boolean }
  | { kind: "forbidden" } | { kind: "not_found" }
  | { kind: "stale" }                                             // version mismatch
  | { kind: "slug_taken" } | { kind: "invalid_input"; field: string; message: string }
  | { kind: "incomplete"; missing: ("title"|"summary"|"location"|"description")[] }
  | { kind: "closing_date_passed" } | { kind: "publish_limit" }
  | { kind: "invalid_transition" };

listPostings(viewerPersonId, organizationId): Promise<CareersResult<{ postings: PostingRow[]; orgToday: string }>>
getPosting(viewerPersonId, organizationId, postingId): Promise<CareersResult<{ posting: PostingRow; orgToday: string }>>
createPosting(viewerPersonId, organizationId, actor, input: PostingInput): Promise<CareersResult<{ id: string }>>
updatePosting(viewerPersonId, organizationId, actor, input: PostingUpdateInput): Promise<CareersResult<{ version: number }>>
setPostingStatus(viewerPersonId, organizationId, actor,
  input: { id: string; version: number; to: "published" | "closed" }): Promise<CareersResult<{ status: PostingStatus; version: number }>>
movePosting(viewerPersonId, organizationId, actor,
  input: { id: string; direction: "up" | "down" }): Promise<CareersResult<{ moved: boolean }>>
```

- `feature_off` carries `canManageFeatures` (a `presby_has_permission(…, 'org_features.manage')` read in the same transaction) so the page can offer the Features link only to someone who can use it.
- **Compare-and-set:** `updatePosting` and `setPostingStatus` do `update … where id = $1 and organization_id = $2 and version = $3`; zero rows after the posting is known to exist is `stale`. The trigger owns `version`.
- **Publish and reopen (`to: "published"`)** require title, summary, location and description non-empty (`incomplete`), a closing date that is empty or not before org-local today (`closing_date_passed`), and fewer than 100 other published postings (`publish_limit`, also enforced in the trigger). Edges allowed: draft→published, published→closed, closed→published, draft→closed ("discard"). Anything else is `invalid_transition`.
- **Update** validates every field with the shared pure validators (below) before the statement; `description_md` goes through `validateDescription`, whose normalised output is what is stored. Editing a published posting's closing date to a passed date is `invalid_input` on `closingDate` ("close it instead").
- **Slug:** generated from the title on create (pure `slugFromTitle`, suffix `-2`, `-3`… on collision, at most 50 tries). Editable only while `first_published_at` is null; the trigger refuses otherwise and the lib returns `invalid_input` on `slug`. A unique violation (`isPgError(err, "23505", "job_postings_org_slug_key")`, `src/lib/db/errors.ts`) is mapped outside the aborted transaction to `slug_taken`.
- **`movePosting`** locks the organization's published rows (`select … for update`, ordered), moves the target one place within the published sequence, and rewrites `sort_order` densely (0..n−1) for changed rows only. Only published postings are orderable. Reordering does not bump `version` or `updated_at`.
- **Audit (in the same transaction, `insertAuditRow` from `src/lib/audit-tx.ts`):** one row per status change that changes what the public can read:

| Path | Fires when | Action | Metadata (ids and enum only; no title, no slug) |
|---|---|---|---|
| `setPostingStatus` draft→published | always | `CAREERS_POSTING_PUBLISHED` | `{ organizationId, postingId, via: "staff" }` |
| `setPostingStatus` published→closed | always | `CAREERS_POSTING_CLOSED` | `{ organizationId, postingId, via: "staff" }` |
| `setPostingStatus` closed→published | always | `CAREERS_POSTING_REOPENED` | `{ organizationId, postingId, via: "staff" }` |
| `setPostingStatus` draft→closed (discard) | never: nothing was ever public | none | — |
| cron sweep | each posting closed | `CAREERS_POSTING_CLOSED` | `{ organizationId, postingId, via: "closing_date" }`, actor null |
| create, edit, reorder | never (not disclosure changes; an edit to a published posting is live but is not a status change) | none | — |

`resourceType: "job_posting"`, `resourceId`: the posting id. The audit insert shares the change's transaction, so a failed audit insert fails the change.

### Pure helpers (shared by the action, the lib and the client)

- `description.ts` — `validateDescription(raw, { requireNonEmpty }): { ok: true; value: string } | { ok: false; errors: { line: number; snippet: string; code: string; message: string }[] }`. Rules: NFC; CRLF→LF; remove C0/C1 control characters except `\n` and `\t`; remove bidi controls (U+202A–U+202E, U+2066–U+2069, U+200E/F), zero-width characters (U+200B–U+200D, U+2060, U+FEFF); at most 20,000 characters after normalising. A line starting `# ` (one `#`) or `####` and deeper is refused (`heading_level`): the page owns the `h1`, and levels 4–6 are unstyled. Every `[label](href)` the renderer would link (the renderer's own pattern `\[([^\]]+)\]\(([^)\s]+)\)`) must have an `href` that is absolute `https:`, `http:` or `mailto:`, at most 2,000 characters, parses with `URL`, has a host (for `mailto:`, a bare address `name@host.invalid` with **no** `?` query or `&`), and carries no credentials. `https://` with no host is its own error (`link_unfinished`), because the toolbar inserts it as a placeholder. A relative link, `tel:`, `javascript:`, `data:`, a protocol-relative `//host` and anything else is `link_scheme`. The validator is strictly narrower than site-kit's `sanitizeHref`; T9 pins that every href it accepts renders as an `<a>`.
- `toolbar.ts` — `applyToolbar(state: { value: string; start: number; end: number }, action: "heading"|"subheading"|"bold"|"italic"|"bullets"|"numbers"|"link"): { value; start; end }`. Block actions work per selected line (a second press removes the marker); `bold` and `italic` wrap `**…**` and `*…*` (a second press unwraps); `link` wraps the selection as `[selection](https://)` and selects `https://` (or inserts `[your link text](https://)` with the placeholder selected when nothing is selected).
- `html-to-markdown.ts` — `htmlToMarkdown(html: string, parse?: (html: string) => Document): { markdown: string; droppedLinks: number }`. Takes the DOM parser as an argument (default `new DOMParser()`; jsdom in tests). Input over 200,000 characters returns `null` and the caller lets the browser paste plain text. Rules: `h1`/`h2`→`## `, `h3`–`h6`→`### `; `p`/`div` paragraphs separated by a blank line; `br`→space (the renderer joins lines); `strong`/`b` and spans with weight ≥600→`**`; `em`/`i` and italic spans→`*` (a Google Docs wrapper `<b style="font-weight:normal">` is not bold); `a[href]`→`[text](href)` only when the href passes the same link rule, otherwise the text alone and `droppedLinks` counts it; `ul`/`ol` items→`- ` and `n. `, nested lists flattened to the same level; table cells flattened to paragraphs; `script`, `style`, `meta`, comments, images and everything else non-textual dropped; a literal `*` in text becomes U+2217 (there is no escape syntax in the renderer, finding P3-8); whitespace collapsed; NFC; control and bidi characters stripped; result trimmed. The output of every fixture must pass `validateDescription` (T11).
- `input.ts` (zod) — `postingInputSchema` and `postingUpdateSchema`: `title` 1–150, `summary` 0–300 (1–300 to publish), `location` 0–200, `employmentType`, `payMinCents`/`payMaxCents` integers 0–100,000,000 with `min <= max`, `payUnit` required whenever either amount is given and absent otherwise, `closingDate` a real calendar day (`isDayKey` from `src/lib/calendar/month.ts`) between 2000-01-01 and 2100-01-01, `slug` per `^[a-z0-9]+(-[a-z0-9]+)*$` and 1–80, ids `z.guid()`, `version` integer ≥1. Plain-text fields go through `cleanText` (NFC, control and bidi stripped, trimmed). `parseDollarsToCents("$52,000.50")`: accepts `^\d{1,7}(\.\d{1,2})?$` after removing `$`, commas and spaces; everything else (exponent, three decimals, negative) is null.
- `slug.ts` — `slugFromTitle(title)`: NFKD, strip diacritics, lower-case, non-alphanumerics to hyphens, collapse, cut at 60 on a hyphen boundary, fall back to `opening` when nothing is left.
- `placement.ts` — `findSlotPages(pages: { path: string; mdxAst: unknown }[], slot: string): string[]` mirrors site-kit's own defensive `extractBlocks` (`isRecord(ast)`, `Array.isArray(ast.blocks)`, string `type`, record `props`) and returns the paths of pages carrying a `liveSlot` block whose `props.slot` equals `slot`; `describePlacement(...)` returns the four states of Copy S5; `careersBackTarget(...)` picks the posting page's back link: the first slot page if any, else `urls.careers()` when the bundle has no page of its own at `/careers`, else the site home.
- `dates.ts` — `isStale(postedOn, closingDate, orgToday)` (published ≥ 60 days with no closing date) built on the pure helpers in `src/lib/calendar/month.ts` (`isDayKey`, `addDays`, `formatLongDate`).

### Server actions (`src/app/(org)/o/[slug]/admin/careers/actions.ts`, `"use server"`)

```ts
createPostingAction(slug: string, input: PostingInput): Promise<ActionResult<{ id: string }>>
updatePostingAction(slug: string, input: PostingUpdateInput): Promise<ActionResult<{ version: number }>>
setPostingStatusAction(slug: string, input: { id: string; version: number; to: "published"|"closed" }): Promise<ActionResult<{ status: PostingStatus; version: number }>>
movePostingAction(slug: string, input: { id: string; direction: "up"|"down" }): Promise<ActionResult<{ moved: boolean }>>
```
Each re-resolves the slug through `resolveOrgContext()` for the acting session (`organizationId` never comes from form data), parses with the zod schema, calls the lib, and maps each `CareersResult` kind to a string in Copy S8. Mutations that write no audit row carry `// audit-exempt:` comments naming the reason (the `staff/actions.ts` precedent); the three audited status paths write their rows inside `postings.ts`, and a source-scan test (T24) pins that every status writer there is followed by `insertAuditRow` or sits on the no-audit rows of the table above. `USES auth()` directly, as every `actions.ts` does.

### Routes (page routes only)

| Route | Purpose | States |
|---|---|---|
| `(public)/site/[slug]/careers/page.tsx` | `/careers` on the platform host (`/site/<slug>/careers`) and on a custom host (`/careers`) | bundle has a `/careers` page → that page; else list available → the list; `failed` → notice (200, `noindex`); `unavailable` or site not serving → `notFound()` |
| `(public)/site/[slug]/careers/[posting]/page.tsx` | one opening | `open` → posting; `closed` → closed view, `noindex`; `failed` → notice (200, `noindex`); `unavailable`, `not_found` → `notFound()` |
| `(public)/site/[slug]/careers-slot.tsx` | the `careers` live slot (`PublicCareersSlot`) | `unavailable` and `failed` → the one notice; `available` empty → empty state; else the list |
| `(org)/o/[slug]/admin/careers/page.tsx`, `new/page.tsx`, `[postingId]/page.tsx` | staff list, create, edit | `feature_off`, `forbidden`, load error, `not_found`, ok |

Both public pages are `force-dynamic`, have **no `loading.tsx`** (CLAUDE.md, The `(org)` contract: a segment that may 404 must not open a Suspense boundary), and resolve their site with `resolveSiteOrganization(key)`: anything but `ok` is the page's one `notFound()` (DECISION-121's presbytery sign-in fallback is switched off, as `/give` does). They call `redirectIfNeeded(target, { path, search })` so a slug URL hands off (307, `no-store`) to a serving custom host and an alias to the canonical host. The posting page's `[posting]` is a segment name only; the site key is the parent `[slug]`. A bundle page at exactly `/careers` wins over the platform list: the route calls `renderSitePage(key, "/careers", { presbyteryFallback: false })` first and uses its node when `kind === "page"`.

`generateMetadata` on each: absolute title `Job openings | {Organization}` and `{Posting title} | {Organization}` (`title: { absolute }`, bypassing the platform template); description from the summary; `alternates.canonical` is `urls.origin + urls.careersPosting(slug)` (host mode names the church host); `robots: { index: false }` for `closed`, `failed` and any notice. A bundle `/careers` page uses `siteBundleMetadata`.

### `SiteUrls` (`src/lib/site-urls.ts`)

Added to the interface and both builders: `careers()` → `page("/careers")`; `careersPosting(postingSlug)` → `page("/careers/" + encodeURIComponent(postingSlug))`. Host mode gives `/careers` and `/careers/<slug>`; slug mode gives `/site/<slug>/careers…`. Every careers link in the public tree comes from these (T17 renders with a fake `urls` and asserts each `href`). The existing source-scan test that bans a hand-built `/site/${…}` is unaffected.

### Reserved paths (`src/lib/sites-reserved-paths.ts`)

Add a descendants-only list: `RESERVED_SITE_DESCENDANTS = ["careers"]`. `reservedSitePath()` keeps its normalisation (decode once, `\` to `/`, lower-case, drop empty and `.` segments) and returns `{ reserved: true, segment: "careers" }` when the first segment is `careers` **and there is at least one more segment**. Exact `/careers` (any trailing-slash or case variant) stays allowed. The ingest route's message for this case (Copy I1) must not say `/careers` itself is reserved.

### Slot wiring (`render-site-page.tsx`)

```tsx
liveSlots: {
  …,
  // Closes over the DB-returned `slug` and `urls` ONLY (DECISION-132): never `key`, request, headers, cookies, searchParams.
  [CAREERS_SLOT]: () => <PublicCareersSlot slug={slug} urls={urls} />,
}
```
The marker's `filter` is read for nothing in v1. Slot name constant imported from `contract.ts`; T18 asserts the closure.

### Cron (`src/app/api/cron/maintenance/route.ts`)

After the existing roll reconcile, one isolated step:

```ts
let careersPostingsClosed = 0;
try { careersPostingsClosed = await runCareersSweep(); }
catch { console.error("[cron/maintenance] careers sweep failed"); }   // counts and a fixed label only
```
`runCareersSweep()` (`src/lib/careers/sweep.ts`, the only `getPlatformDb()` user in `src/lib/careers/`) opens one platform transaction, executes ``select * from presby_careers_sweep(200)``, writes one `CAREERS_POSTING_CLOSED` row per returned `posting_closed` row through `insertAuditRow` (actor null, `via: "closing_date"`), and returns the count. A failure in the sweep or its audit rolls the whole step back and cannot stop the token pruning or the roll reconcile, which have already run. The response and the structured log gain `careersPostingsClosed`. `vercel.json` and `cron-passthrough.ts` are not touched; `src/proxy.ts` is not touched.

### Tile (`src/lib/org-portal/tiles.ts`)

```ts
{ key: "careers", label: "Job openings",
  description: "Post and manage job openings for your website.",
  href: (slug) => `/o/${slug}/admin/careers`,
  orgFeatureKey: "org_portal.careers", category: "operate", domain: "people" }
```
Toggle-only (no `flagKey`), no `orgTypeScope`, permission-blind like every tile (DECISION-162): the destination renders its own honest state. The 7-day badge is Increment 2.

## Data Model

One migration, `drizzle/0071_presby_careers.sql`. Idempotent in the house style: `if not exists`, `on conflict do nothing`, drop-then-add for constraints and triggers, `create or replace`, revoke-then-grant; proven by applying the whole file twice on the pipeline branch.

1. **Permission catalog.** `insert into permissions (key, module, description, sensitivity_tier) values ('careers.manage','careers', …, 1), ('careers.applicants','careers', …, 3) on conflict (key) do nothing`. Descriptions per Copy R.
2. **Founding-administrator backfill (0057 pattern).** `insert into app_role_permissions (role_id, permission_key) select r.id, k.key from app_roles r cross join (values ('careers.manage'),('careers.applicants')) k(key) where r.key = 'founding_administrator' and r.organization_id is not null on conflict do nothing`. The giving guard ignores non-giving keys. Residual, as 0057: this re-adds a key a tenant removed from a designation-minted role.
3. **`hiring_committee` template.** `insert into app_roles (organization_id, organization_type_scope, key, name, role_kind, is_protected) select null, null, 'hiring_committee', 'Hiring Committee', 'custom', false where not exists (select 1 from app_roles where organization_id is null and key = 'hiring_committee')`, then bind both keys by `on conflict do nothing`. `custom`, not `constitutional`: it fails DECISION-078's test (no PC(USA) office's duty is hiring), the `giving_recorder` precedent. Universal scope, because presbyteries and synods hire.
4. **`job_postings`:**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `organization_id` | `uuid not null references organizations(id) on delete cascade` | cascade reachable only through D10's guarded fixture teardown |
| `slug` | `text not null` | CHECK shape and length 1–80 |
| `title` | `text not null` | `char_length(btrim(title)) between 1 and 150` |
| `summary` | `text not null default ''` | ≤ 300 |
| `location` | `text not null default ''` | ≤ 200 |
| `employment_type` | `text not null default 'full_time'` | `full_time`, `part_time`, `intern` (fpcw's three; widening is a one-line drop-then-add) |
| `pay_min_cents`, `pay_max_cents` | `integer` null | 0–100,000,000; `min <= max` when both |
| `pay_unit` | `text` null | `hour`, `year`; null iff both amounts null |
| `description_md` | `text not null default ''` | ≤ 20,000 |
| `closing_date` | `date` null | the last day applications are accepted, org zone; 2000-01-01 to 2100-01-01 |
| `status` | `text not null default 'draft'` | `draft`, `published`, `closed` |
| `sort_order` | `integer not null default 0` | meaningful for published rows only |
| `version` | `integer not null default 1` | trigger-owned |
| `posted_on` | `date` null | trigger-set once, at first publish |
| `first_published_at` | `timestamptz` null | trigger-set once; the public-visibility gate for closed rows |
| `closed_at` | `timestamptz` null | trigger-set on close, cleared on reopen |
| `created_by`, `updated_by` | `uuid references users(id) on delete set null` | |
| `created_at`, `updated_at` | `timestamptz not null default now()` | `updated_at` trigger-owned |

   Constraints: `job_postings_id_org_key unique (id, organization_id)` (Composite Tenant Keys; the target of Increment 2's applications FK); `job_postings_org_slug_key unique (organization_id, slug)`; the CHECKs above, each drop-then-add; `job_postings_complete_when_live` (`status = 'draft' or (btrim(summary) <> '' and btrim(location) <> '' and btrim(description_md) <> '')`); `job_postings_published_stamped` (`status <> 'published' or first_published_at is not null`); `job_postings_closed_stamped` (`(status = 'closed') = (closed_at is not null)`); `job_postings_posted_stamped` (`(posted_on is null) = (first_published_at is null)`). Indexes: `(organization_id, status, sort_order)`, and the sweep's `job_postings_closing_due_ix` on `(closing_date) where status = 'published' and closing_date is not null`.
5. **Guards** (all `SECURITY INVOKER`, `set search_path = public, pg_temp`, trigger functions revoked from `public, presby_app, presby_platform`; all bind the owner too, F44). Refusals are `check_violation` (23514) with a `job_postings:` message prefix so a test can tell a trigger refusal from a grant refusal (`insufficient_privilege`, 42501).
   - **Insert:** status must be `draft`; `version := 1`; `first_published_at`, `posted_on`, `closed_at` forced null; timestamps `now()`.
   - **Update:** `id`, `organization_id`, `created_at`, `created_by` immutable. Status edges as listed in the API Contract; any other edge refused. On →`published`: take an advisory transaction lock on the organization (`pg_advisory_xact_lock(hashtext('job_postings:' || organization_id))`), refuse when 100 other published rows exist (D13), refuse when `closing_date < presby_careers_org_today(organization_id)`, set `first_published_at := coalesce(old.first_published_at, now())`, `posted_on := coalesce(old.posted_on, new.posted_on, org today)` (a caller can supply `new.posted_on` only on the owner path, because `presby_app` holds no column privilege on it: this is how the Track K import carries original dates), `closed_at := null`, and `sort_order := coalesce(min(sort_order) of the org's other published rows, 1) - 1` (newest at the top). On →`closed`: `closed_at := now()`. Otherwise `first_published_at`, `posted_on`, `closed_at` are carried from `old`. `slug` may change only while `old.first_published_at is null`. `version := old.version + 1` and `updated_at := now()` when any of title, summary, description, location, type, pay fields, closing date, slug or status differs; a `sort_order` change alone bumps neither `version` nor `updated_at`.
   - **Delete:** refused (`insufficient_privilege`, "job_postings: postings are permanent; close them instead") unless the parent `organizations` row is already gone (the fixture-teardown cascade), the `presby_org_domains_guard_delete` idiom.
6. **RLS and grants.** `enable` + `force row level security`; policy `tenant_isolation using (organization_id = presby_current_org()) with check (organization_id = presby_current_org())`. `presby_app`: `select`; `insert (organization_id, slug, title, summary, location, employment_type, pay_min_cents, pay_max_cents, pay_unit, description_md, closing_date, created_by, updated_by)`; `update (slug, title, summary, location, employment_type, pay_min_cents, pay_max_cents, pay_unit, description_md, closing_date, status, sort_order, updated_by)`; **no delete**. The trigger-owned columns (`id`, `version`, `posted_on`, `first_published_at`, `closed_at`, `created_*`, `updated_at`) are outside both column lists: a column privilege is checked against the statement's target list, not against what a BEFORE trigger assigns, which is the `organization_domains` precedent. `presby_platform` gets nothing (Two Hierarchies: no platform page reads careers data).
7. **Functions** as listed in the API Contract, with `comment on function` for each.
8. **Comments** on the table, on `slug`, `version`, `first_published_at`, `posted_on` and `closing_date`.

**What the migration does not do, on purpose.** It writes no audit row (a migration is provisioning). It creates no applications, no files and no email objects (Increment 2, migration 0075). It adds no toggle row (the toggle catalog is TypeScript; `organization_feature_toggles.feature_key` has no CHECK). It adds no `blob_assets` use. Residual, `paper`: RLS enforces tenancy, not authorization, so a bug in the app could show a **draft** to any member of the same organization; `careers.manage` is checked in the app, and drafts are tier-1 content.

**Drizzle mirror** `src/lib/db/domain/careers.ts`: `jobPostings` with `date(…, { mode: "string" })` for the three date columns, the unique constraints and the check constraints. `check:schema-parity` compares presence, nullability and FK shape and needs the export in `src/lib/db/domain/index.ts`, a Rule 16 shared file: Phase 4 adds the line locally to run parity and leaves it out of the commit; it is an integration item below.

### Feasibility check against the live tree (done 2026-10-25; Phase 4 start re-runs it)

- **Signatures.** The only parameter default is `p_limit integer default 200` on a one-parameter function, and `p_posting text default null` trailing `p_slug text`. Valid SQL.
- **ALTER and DROP.** No `ALTER` or `DROP` against an existing column or table. `create or replace function presby_founding_administrator_permission_keys(text)` keeps its signature and return type (`text[]`); its one SQL caller is `presby_apply_founding_administrator` (`drizzle/0059:613`), a `SECURITY DEFINER` body that references it by name, so it keeps working. Only `0059` defines the function; I grepped the `drizzle/` directories of all eight sibling worktrees (treasury, cal, assets, 2b, inc3, otp, parish, devportal) and none redefines or touches it. **Integration hazard for the orchestrator:** if any pipeline later changes this function, the second to merge must re-read the live body, because two `create or replace`s with different arrays silently drop the first one's keys; `invitations.db.test.ts:571` (SQL equals TypeScript for every organization type) is what would catch it.
- **New CHECKs and triggers against fixtures.** `job_postings` is new, so no fixture writes to it. The new template row changes the count asserted at `scripts/test-rls.sql:7911-7912` (6 templates) to 7: an integration patch, and a test blast-radius item below. `scripts/test-rls.sql:8047-8052` builds a hand-listed `founding_administrator` role at run time (after the backfill), unaffected. No fixture inserts a `hiring_committee` or `careers.*` key (grepped `scripts/`, `src/`, `e2e/`, `drizzle/`).
- **New FKs.** `job_postings.organization_id → organizations(id)` (a single-column FK to a non-tenant table, the `organization_domains` shape) and `created_by`/`updated_by → users(id)`. No FK between two tenant tables, so no composite FK is needed here; the tenant column on `job_postings` is `organization_id`, and the `(id, organization_id)` unique is the target Increment 2's FK will use.
- **`SECURITY DEFINER` bodies that read what this touches.** None references `job_postings` (new). The trigger and the helper read `organization_settings` (the helper as definer; the trigger through the helper).
- **`OrgTx` for the platform transaction.** `insertAuditRow` takes `OrgTx`, derived from `db.transaction`; `getPlatformDb().transaction` yields a structurally identical type on the same driver. Phase 4 confirms at typecheck; if it does not unify, widen the parameter to the common structural type rather than casting.
- **Cron test.** `src/app/api/cron/maintenance/route.test.ts:129-134` pins exactly one platform `execute` and that call 0 is the roll reconcile; the sweep adds a platform transaction. Listed under the blast radius.

## Component / Page Plan

**Create — lib and components**
- `src/lib/db/domain/careers.ts`; `drizzle/0071_presby_careers.sql`.
- `src/lib/careers/`: `contract.ts`, `text.ts` (`cleanText`), `description.ts`, `toolbar.ts`, `html-to-markdown.ts`, `input.ts`, `slug.ts`, `dates.ts`, `placement.ts`, `public.ts`, `placement-read.ts` (server-only; wraps `resolveSite` in one try/catch, returns the walker's input or `unknown`), `postings.ts`, `sweep.ts`, plus a test beside each and `boundaries.test.ts`.
- `src/components/careers/`: `posting-description.tsx` (no `'use client'`; wraps `<Prose body>` in a plain `div` whose typography is Tailwind arbitrary variants written as full static literals: `h2`/`h3` sizes, `ul`/`ol` list styles and indent, link colour and underline, `[overflow-wrap:anywhere]`), `careers-list.tsx` (cards; `headingLevel` fixed at `h2`), `posting-meta.tsx` (type, location, pay, dates), `careers-notice.tsx` (P1 and P2).

**Create — public tree (flat files; none is a routable name)**
- `src/app/(public)/site/[slug]/careers/page.tsx`, `careers/[posting]/page.tsx`, `careers-slot.tsx`, `careers/posting-view.tsx`.

**Create — staff tree** (`src/app/(org)/o/[slug]/admin/careers/`)
- `page.tsx` (list), `new/page.tsx`, `[postingId]/page.tsx`, `actions.ts`, `careers-states.tsx` (`CareersFeatureOff`, `CareersForbidden`, `CareersLoadError`, `CareersNotFound`), `postings-list.tsx` (server), `placement-line.tsx` (server), `posting-form.tsx` (`'use client'`, react-hook-form + zod, `HydrationGate`, unsaved-changes guard), `posting-schema.ts` (string-valued form schema and `toPostingInput`), `description-editor.tsx` (`'use client'`: textarea, toolbar, counter, paste handler, preview), `description-preview.tsx` (`'use client'`: the shared `PostingDescription`), `status-controls.tsx` (`'use client'`: publish, close, reopen, discard with `AlertDialog`s), `move-buttons.tsx` (`'use client'`).
- Fixtures and scripts: `scripts/careers/test-rls-71.sql`, `scripts/careers/seed-dev-careers.sql` (owner fixture: Bramblewood and Fernwood get a `live` site and the toggle on, with one posting in each state including a past closing date and a discarded draft; Alder Creek keeps a `provisioning` site with the toggle on), `scripts/careers/test-rls.sql.integration.patch` (the `\ir`, and the 6→7 template-count change).
- `e2e/careers.spec.ts`, `e2e/custom-domains/careers.spec.ts`, `e2e/hydration/careers-posting-form.spec.ts`, `e2e/support/careers-fixture.ts`.

**Modify**
- `src/lib/onboarding/founding-administrator.ts` (two keys after `domains.manage`; its comment block cites F150, add the careers reasoning), `src/lib/onboarding/designation-parity.golden.json` (regenerated; see Implementation Order 3), `src/lib/onboarding/founding-administrator.test.ts`, `src/app/(admin)/admin/organizations/[id]/founding-administrator-section.tsx` (`PERMISSION_LABELS`) and its test.
- `src/lib/org-features.ts` (catalog entry), `src/lib/org-portal/tiles.ts` (tile), `src/components/org-portal/tile-icons.tsx` (`careers: Briefcase`), `src/lib/audit.ts` (three keys), `src/lib/site-urls.ts`, `src/lib/sites-reserved-paths.ts`, `src/app/api/sites/ingest/route.ts:115-117` (message), `src/app/(public)/site/[slug]/render-site-page.tsx` (slot), `src/app/api/cron/maintenance/route.ts`.
- Tests that change are listed under the blast radius.
- `CLAUDE.md` and `docs/product/functionality-map.md` at ship (Integration items), not in Phase 4.

## Implementation Order

Three implementers, in order. Each hands off the signatures in the API Contract; the next does not start until the previous batch's gates are green.

**Starting conditions.** Create the Neon branch from `development` (never from production: a branch from production holds applicant data until deleted, Phase 2 Note 6) and `.env.local` in `presby-careers`; port 3580, `E2E_BASE_URL=http://localhost:3580` for every Playwright, `next dev` and `next start` run; a run that attached to :3000 is discarded. Merge main into `pipeline/careers`. Re-run the feasibility list. Apply migrations with `psql` as the owner (the numbers 0065–0070 belong to other pipelines and are absent from this branch's directory; the journal entry is the orchestrator's).

**Batch 1 — database-admin (schema, definers, the bundle in all three places).**
1. Write `0071` and `src/lib/db/domain/careers.ts`. Apply twice (idempotence).
2. Re-read on the branch, not from the DDL text: `pg_proc.proacl` and `proconfig` for the four functions (no PUBLIC execute; `presby_app` yes only for `presby_public_careers` and `presby_careers_org_today`; the sweep has none; `search_path = public, pg_temp`), `pg_constraint` for every CHECK, `relforcerowsecurity`, `pg_trigger` for the three guards, and the column privileges (`information_schema.column_privileges`) for `presby_app` (F38/F152 drift class).
3. Update `foundingAdministratorPlan()`, the label map, `founding-administrator.test.ts` and the section test. Regenerate the golden with `WRITE_DESIGNATION_GOLDEN=1` against the branch: the recorded ruling that the effect is meant to change is the operator's Q4 ruling and DECISION-265, cited in the commit body. Diff the golden: only `careers.applicants` and `careers.manage` added, to every `founding_administrator` entry, nothing else.
4. Write `scripts/careers/` (RLS suite as `presby_app`, owner fixture, integration patch). Run `npm run check:schema-parity` (with the local domain export), `npm run docs:erd`. The invitations DB tests and the parity DB test stay green in this batch's gate.

**Batch 2 — api-developer (lib, catalog, audit, cron, actions).**
5. Pure files first, each test-first: `text.ts`, `description.ts`, `toolbar.ts`, `slug.ts`, `input.ts`, `dates.ts`, `placement.ts`, `contract.ts`, `html-to-markdown.ts`.
6. `ORG_FEATURE_CATALOG` entry, `AUDIT_ACTIONS` keys, `SiteUrls` methods, reserved-path rule and ingest message, tile and icon.
7. `public.ts`, `placement-read.ts`, `postings.ts`, `sweep.ts`, the cron step, `actions.ts`. The state-machine, stale, permission and audit-rollback tests (T15) are written first and seen to fail.

**Batch 3 — ux-developer (staff UI, public UI, e2e).**
8. Shared components, public routes and slot, `render-site-page.tsx` wiring.
9. Staff pages, form, editor, preview, status controls, move buttons.
10. e2e and hydration specs; browser checks at 360px on both host modes; report the editor route's client chunk size.
11. Gates: `npm run typecheck`, `npm run check` (all eight), `npm run lint`, `npm test`, `npm run test:db` for the DB-backed files, `scripts/careers/test-rls-71.sql` as `presby_app`, the three e2e specs with `E2E_BASE_URL` set, `npm run test:e2e:prod` for the hydration spec.

**Phase 6 housekeeping (tech-lead, not the implementer):** release notes via `/release-notes` (version assigned at integration; Copy N is the starting text), Rule 14 functionality-map edit, Rule 10 TODO reconciliation, Rule 13 what's-new advisory (staff-visible). `docs/architecture.md` is **not** touched at this increment (Rule 15; Increment 2).

### Tests the implementer writes (QA runs them)

| ID | Test | File |
|---|---|---|
| T1 | Catalog and bundle: both keys exist (module `careers`, tiers 1 and 3, `requires_two_factor` false); `hiring_committee` exists once, universal scope, `custom`, exactly the two keys; every org-owned `founding_administrator` role at every organization holds both (the 47n pattern); no other template carries `careers.applicants` | `scripts/careers/test-rls-71.sql` |
| T2 | Table posture: FORCE RLS, `tenant_isolation`; `presby_app` column grants exactly as specified and no DELETE; `presby_platform` has no privilege; org B cannot read, insert or update org A's rows; a cross-org insert is refused by WITH CHECK; `unique (id, organization_id)` exists | same |
| T3 | Guards, as `presby_app` and as the owner: insert is born `draft` and a supplied `published` is refused; all four legal edges pass, a same-status update passes, and the two edges back into `draft` (from `published` and from `closed`) are refused; caller-supplied `version`, `first_published_at`, `closed_at` are ignored or unreachable; `posted_on` is stamped once and the owner may supply it only at first publish; slug changes before first publish and is refused after (including for the owner, including after reopen); `version` bumps on a content change and not on a `sort_order` change; `closed_at` set on close and cleared on reopen; publishing with an empty summary, location or description is refused; publishing with a passed closing date is refused; the 101st published posting is refused (and two concurrent publishes cannot both take the 100th); pay CHECKs (unit without amounts, amounts without unit, min over max, negative, over cap); DELETE refused for both roles; teardown cascade through a `deletable_until` organization works | same |
| T4 | Public definer as `presby_app`: `unavailable` is the **identical** row for unknown slug, inactive organization, site not `live` (Alder Creek), toggle missing, toggle off, and category off with the axis on; exactly one row always; list contains only published postings that are open (closing date today is in, yesterday is out, in an organization whose zone is `Pacific/Kiritimati`, and again in `Pacific/Pago_Pago`); drafts, closed and discarded drafts are absent; list keys equal the allow-list exactly and contain no id or description; `open` returns the 11 keys; `closed` returns `slug` and `title` only and never the description; a discarded draft, a draft, an unknown slug, a malformed slug (uppercase, spaces, `../`, 81 characters, empty) and another organization's slug are all `not_found`; organization A's postings never appear under B's slug in either direction; the list limit is 100 (proved in a transaction that disables the cap trigger as the owner, inserts 101 published rows, reads the list, and rolls back; the trigger itself refuses the 101st, T3); PUBLIC and `presby_platform` have no EXECUTE, `presby_app` has; `search_path` pinned | same |
| T5 | Sweep and helper: owner-only (`presby_app`, `presby_platform` and PUBLIC are refused); closes only published postings past their closing date in the organization's zone; leaves drafts, closed, no-date and future-date rows; honours the limit and the clamp; returns one `posting_closed` row per posting with `application_id` null; a second run returns none; ignores the toggle; `presby_careers_org_today` honours the zone, returns the default-zone date for an unknown id, and has the grants stated | same |
| T6 | Differential toggle test: the definer's availability equals `orgFeatureEnabledInTx` for every combination of axis flag (on, off, row missing) × category row (on, off, missing) × toggle row (on, off, missing) (fixture organization with `deletable_until`; the global axis flag captured and restored in `finally`; serial). Pins: the migration text contains the literals `org_portal.careers`, `'people'`, `org_portal.feature_categories`, `c_cap constant integer := 100` and the default-zone literal, each equal to the TypeScript constant or catalog value; the catalog entry has `category === "people"`, `flag === null`, `orgTypes === null`, `operatorEnabled === false`; `isCategoryAxisOn` reads the same flag key as the SQL | `src/lib/careers/public.db.test.ts` |
| T7 | Bundle parity: `invitations.db.test.ts:571` (SQL equals TypeScript for every organization type) passes unchanged; `designation-parity.db.test.ts` passes against the regenerated golden; the golden diff contains only the two keys; `founding-administrator.test.ts` asserts both keys are in the base and in the presbytery plan, that neither is bound to a stated-clerk office template, and that each appears once | existing files, updated |
| T8 | Description validator, table-driven: NFC; CRLF; control, bidi and zero-width removal (a name with U+202E is stripped); length 20,000 passes and 20,001 fails; `# x` refused, `## x` and `### x` pass, `#### x` refused; links: `https`, `http`, `mailto:name@example.invalid`, uppercase scheme pass; `javascript:`, `data:`, `tel:`, `/relative`, `//host`, `ftp:`, `mailto:name@example.invalid?body=x`, `https://u:p@host`, `https://` (unfinished), a 2,001-character URL, whitespace in the URL fail with the right code, line number and snippet; an empty description is allowed for a draft and refused when `requireNonEmpty`; idempotent (`validate(validate(x).value)` equals itself) | `src/lib/careers/description.test.ts` |
| T9 | Renderer agreement: for every href the validator accepts, `renderToStaticMarkup(<Prose body=…/>)` contains an `<a href>` with that href; hostile bodies (`<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `[x](javascript:alert(1))`, `**<b>**`) render as inert text with no `<script`, no `onerror` attribute and no `javascript:` href; the `PostingDescription` wrapper emits no `.presby-site` class and no `dangerouslySetInnerHTML` | `src/components/careers/posting-description.test.tsx` |
| T10 | Toolbar: every action on an empty selection, a one-word selection and a multi-line selection; block actions toggle off on a second press; bold and italic unwrap; link leaves `https://` selected | `src/lib/careers/toolbar.test.ts` |
| T11 | Paste converter in jsdom: a Word fixture (mso classes, `<o:p>`), a Google Docs fixture (the `<b style="font-weight:normal">` wrapper is not bold), nested lists flatten, `javascript:` links dropped and counted, `<br>`, tables flatten, images, `<script>` and `<style>` dropped, a literal `*` becomes U+2217, bidi stripped, oversize input returns null; **every fixture's output passes `validateDescription`**; nothing executes or loads (an `<img src>` and `<script>` fixture leave `window` untouched) | `src/lib/careers/html-to-markdown.test.ts` |
| T12 | Input schema: bounds on every field; `parseDollarsToCents` table (`"45"`, `"45.5"`, `"52,000"`, `"$45"` pass; `"1e3"`, `"45.555"`, `"-1"`, `""` and `"12345678"` fail); `min > max`; unit without amounts and amounts without unit; `2026-02-30` is refused; ids use `z.guid()`; a golden test of the schema shape with tamper cases (the `event-schema.golden.test.ts` precedent) | `src/lib/careers/input.test.ts`, `…/posting-schema.golden.test.ts` |
| T13 | Slug: diacritics, punctuation, 200-character titles (cut on a hyphen at ≤60), all-symbol titles (`opening`), shape accepted by the CHECK | `src/lib/careers/slug.test.ts` |
| T14 | `formatPay` (range, equal, from, up to, none, whole dollars versus cents), `employmentTypeLabel`, `isStale`, `findSlotPages` against malformed `mdxAst` (null, string, `blocks` not an array, a block without `type`, `props` not a record), `describePlacement` for all four cases, `careersBackTarget` for each branch | `src/lib/careers/contract.test.ts`, `dates.test.ts`, `placement.test.ts` |
| T15 | Staff lib on a fixture organization: toggle off → `feature_off` and nothing written, with `canManageFeatures` true only for an `org_features.manage` holder; no `careers.manage` → `forbidden` and nothing written; **a holder of `careers.applicants` alone is `forbidden`** (neither implies the other); stale `version` → `stale`; slug collision → `slug_taken` through a real unique violation; every edge and refusal of the matrix; `incomplete` names the missing fields; `closing_date_passed` on publish and on reopen; `publish_limit`; reorder renumbers densely, moves only published rows, and bumps no `version`; **audit**: a row with the right action and metadata (ids only, no title, no slug) on publish, close and reopen, none on create, edit, reorder or discard, and the row rolls back with a change that fails | `src/lib/careers/postings.db.test.ts` |
| T16 | Public reader and mappers field by field; malformed row, string `postings_json`, over-cap, unknown type or unit, bad date all map to `failed`, never to an empty list; a thrown error returns `failed`, logs the slug only (assert the error text is absent from the log), and a non-slug input never reaches the database; the mapped object has no `id` (`expectTypeOf`) | `src/lib/careers/public.test.ts` |
| T17 | Slot, list and posting view per state: unavailable, failed, empty (with and without a phone), one and many cards; hostile strings (`<script>`, a URL, a 300-character unbroken title) render as text, not elements or links; no uuid-shaped string anywhere in the output; every `href` equals the fake `urls`' output exactly and carries no query string; apply notice with and without a phone; closed view shows no description | `…/careers-slot.test.tsx`, `src/components/careers/careers-list.test.tsx`, `…/posting-view.test.tsx` |
| T18 | Route matrices: `/careers` with (bundle page present × list state) — the bundle page wins whenever it exists; no bundle page and `available` renders the list; `unavailable` and a non-serving site are `notFound()`; `failed` is a noindex notice; the posting page for each of the five states; a custom-host key redirects through `redirectIfNeeded` as `/give` does; **closure discipline**: call `renderSitePage` with a mocked `renderSiteBundle`, invoke `liveSlots.careers`, and with a custom-host key whose database slug differs assert the slot received the database slug and `urls` only (extend the existing closure test) | `…/careers/page.test.tsx`, `…/careers/[posting]/page.test.tsx`, `[[...path]]/page.test.tsx` |
| T19 | `SiteUrls.careers()` and `careersPosting()` in both modes, encoding; `reservedSitePath` table (`/careers` and `/Careers/` allowed; `/careers/x`, `/CAREERS/x`, `/%63areers/x`, `/careers%2Fx`, `\careers\x`, `//careers//x` reserved with segment `careers`; `/careers-guide`, `/about/careers/x`, `/careersx/y` not); the ingest route refuses a bundle page at `/careers/x` with Copy I1, names the page, stores nothing, and accepts `/careers` | `site-urls.test.ts`, `sites-reserved-paths.test.ts`, `src/app/api/sites/ingest/route.test.ts` |
| T20 | Staff pages: toggle off (the Features link only when the viewer holds `org_features.manage`); forbidden; load error; empty; list sections and counts; the derived "closing date has passed" row; stale hint at 60 days; move buttons on published rows only; edit page for each status, including the read-only slug after publish; the four placement-line cases and the "could not check" case | `admin/careers/*.test.tsx` |
| T21 | Editor and controls: toolbar calls `applyToolbar` and keeps focus; paste converts and falls back to plain paste when the converter returns null; preview renders the shared component; counter and over-limit error; **`renderToString` shows the form `disabled` (HydrationGate) and the status and move buttons `disabled` before hydration**; stale result shows Copy S8 and keeps the typed text; publish, close, reopen and discard dialogs pass `{ id, version, to }` and toast from the **returned** result; unsaved-changes guard | `posting-form.test.tsx`, `description-editor.test.tsx`, `status-controls.test.tsx`, `move-buttons.test.tsx` |
| T22 | Catalog, tiles, audit, icons: the toggle-only list in `org-feature-catalog.test.ts:65-70` gains `org_portal.careers` and the entry's pinned shape; `tiles.test.ts` 23 entries and the `careers` row in the expected map; `audit.test.ts` `EXPECTED_ENTRIES` gains the three keys | existing files, updated |
| T23 | Cron: a throwing sweep still returns 200 with every other count and logs no error text; the sweep runs on the platform connection **after** the roll reconcile, so call 0 is still the reconcile; one `CAREERS_POSTING_CLOSED` audit row per closed posting with actor null and `via: "closing_date"`; a failing audit insert rolls the sweep back; the summary and the log line gain `careersPostingsClosed` | `src/app/api/cron/maintenance/route.test.ts`, `src/lib/careers/sweep.db.test.ts` |
| T24 | Boundaries (source scans): nothing under `src/app/(admin)` or `src/lib/admin-portal` imports `@/lib/careers` or `@/lib/db/domain/careers`; `getPlatformDb` appears in `src/lib/careers/` only in `sweep.ts`; no `dangerouslySetInnerHTML` under `src/components/careers` or the careers routes; no `toLocale*`; no `alert(`, `confirm(` or `prompt(`; every status writer in `postings.ts` is followed by `insertAuditRow` or is on the no-audit rows | `src/lib/careers/boundaries.test.ts` |
| T25 | e2e, platform host (throwaway congregation `e2e-careers-<stamp>`; the `mfa-enrolled` fixture user acts, verified once with the existing TOTP helper): toggle off → `/careers` and a posting URL are the site's 404, a bundle page carrying the slot shows Copy P1, the staff page shows Copy S1; toggle on, nothing published → Copy P2; create → the draft is not public (404); publish → in the list, the page shows the description (heading, list, link rendered), the apply notice, no form; a hostile description is text; closing date today shows, yesterday hides (set by SQL); reorder two postings → public order follows; close → the posting page shows Copy P6, `noindex`, no description; reopen; the slug field is read-only after publish and a direct action call is refused; a two-tab edit gives Copy S8 stale and does not overwrite; a bundle with its own `/careers` page wins; a bundle with the slot on `/employment` renders the list inside the site chrome; the category axis on with `people` off gives P1; unpublish then reload removes the posting and the response `Cache-Control` is `no-store` or `no-cache`; a member with no permission sees the tile and the Copy S2 state; **360px** (no horizontal scroll, `scrollWidth <= 360`) for the public list, a posting with a 200-character unbroken title, the staff list, and the editor with the toolbar and preview; toolbar and move buttons ≥44px (bounding box); no console errors | `e2e/careers.spec.ts` |
| T26 | e2e, custom host: list, posting, canonical URL and links name the church host, `/api/*` is a neutral 404, the slug URL 307s to the serving host, no cookie is set, 360px | `e2e/custom-domains/careers.spec.ts` |
| T27 | Hydration, both lanes (`npm run test:e2e` and `npm run test:e2e:prod`): JS chunks held, the editor form is a disabled `fieldset` and the status buttons are disabled; released, they enable | `e2e/hydration/careers-posting-form.spec.ts` |

**Not automatable (QA and the Phase 6 walk):** the toolbar and paste on a real iPhone and Android keyboard; a real Word and Google Docs clipboard (the converter is tested on fixtures I could not take from the real applications); the client chunk size of the editor route (reported at Phase 4, no assertion).

## Edge Cases & Risks

Each claim names its pin or says *unverified*.

- **Default exposure.** Nothing is public until an administrator turns the toggle on **and** staff publish. A new organization, an existing one and one whose toggle row is missing are all off. T4, T6, T25.
- **A failed read looks like "no openings".** It cannot: a failure maps to `failed`, which is never an empty list, and an empty list needs a successful read. T16.
- **Toggle off versus read failure.** Different on the platform pages by design (404 versus notice, D4) and identical in the slot. T18, T25.
- **Enumeration.** `unavailable` is the same row for six causes, and a draft, a discarded draft, a malformed slug, a foreign slug and an unknown slug are all `not_found`, which the page renders as the site's one 404. It discloses only a setting on a site anyone can already view; no id exists to probe. T4, T25.
- **Closed postings.** The public sees the title and the closed notice only; the description is never read for a closed row. A posting past its closing date is closed to the public the moment `org_today` passes it, not when the cron runs (up to about 23 hours later, the cron being 03:00 UTC). T4 (both time zones), T5, T25.
- **Closing-date semantics.** The date is the last day applications are accepted, inclusive, in the organization's zone, as a `date`; no browser or server clock is read. An organization that never set a zone silently gets America/New_York and no zone label is shown, so nothing false is printed. T4, T6 (default-zone pin).
- **Reopen with a passed closing date.** Refused in the lib, in the trigger and (as a note beside the button) in the UI; the manager edits the date, saves, then reopens. T3, T15, T20.
- **Slug stability.** Immutable once first published, also across close and reopen, also for the owner. A saved or shared link keeps working. T3, T25.
- **Two managers editing at once.** The second save gets `stale`, writes nothing and keeps the typed text. T15, T21, T25. The compare-and-set is on `version`, which only content and status bump, so a reorder by someone else does not make an editor's save stale. T15.
- **Reorder races.** The published rows are locked for the move; the dense renumber is applied once. A concurrent publish is serialised by the advisory lock in the trigger. Concurrency itself is *unverified* by test (no harness); T3 tests the 101st-row refusal and T15 the renumber.
- **Silent truncation of the public list.** Closed by D13: more than 100 published postings cannot exist (trigger, advisory lock), and the definer still caps at 100. T3, T4.
- **Free text goes out verbatim.** Titles, summaries, locations and descriptions are staff-authored and public. They render as React text: no HTML, no auto-links, no `dangerouslySetInnerHTML`. T9, T17, T24.
- **Markdown limits the editor cannot express.** There is no escape syntax in the renderer: a literal `*` in text can italicise a span, and a line that begins `- `, `1. ` or `# ` becomes a list or heading. The converter replaces a lone `*` with U+2217; typed text is the author's to correct in the preview. *Residual, accepted, finding P3-8.* Pinned for the converter by T11.
- **Pasted formatting is lossy.** Colours, fonts, images, tables, nested list levels and comments are dropped. The editor hint says what is kept (Copy S6) and tells the author to check the preview. T11. After a converted paste the browser's undo may not restore the original (the value is set by script). *Unverified; accepted.*
- **A link to a bad address.** The toolbar inserts `https://` as a placeholder; the validator refuses it by name, so an unfinished link cannot be published. T8.
- **Preview fidelity.** The preview uses the same component as the public page, but its surroundings (fonts, width) differ; Copy S6 calls it "Preview", not "how it will look". The client chunk carries the whole site-kit (~78 KB of unminified CommonJS) on this one admin route: measured and reported at Phase 4 (T27's gate note), not asserted. **If the kit will not bundle for the client**, fall back to a preview of the last saved text rendered on the server, and tell the orchestrator. *Unverified until Phase 4.*
- **Long names at 360px.** `[overflow-wrap:anywhere]` on titles, summaries and descriptions plus a 200-character unbroken title fixture and a long pasted URL. T25 measures `scrollWidth`. (This is the claim that was false in invite-copy; it is pinned by measurement, not asserted.)
- **Phone-only defects.** The `<details>` for closed postings has no `display` override on its `<summary>` (CLAUDE.md iOS caveat); the toolbar wraps onto two rows; the textarea is 16px so iOS does not zoom. Browser checks above, *unverified in CI*.
- **No-JS and pre-hydration.** The public pages are server-rendered and need no JavaScript. The staff form and buttons are inoperable until hydration. T21, T27.
- **Draft readable by a member via a bug.** `paper`, low: tenancy is RLS, authorization is the app. Named in the Data Model.
- **Cron.** The sweep step is isolated and counts-only in its logs. If migration 0071 is not yet applied when the app deploys, the step fails and is logged, and pruning is unaffected. T23.
- **Cron versus manual close.** If a manager closes a posting that the sweep selected a moment earlier, `skip locked` and the status edge make the second writer a no-op or `invalid_transition`; the audit row is written only for the transition that happened. *Unverified by test* (no concurrency harness).
- **Organization closes or merges.** Postings stay attributed to the organization; the public read requires an `active` organization with a live site, so they vanish with the site. Nothing is deleted.
- **Money.** Pay is US dollars in whole cents, shown with a `$`. An organization outside the US has no currency field. Out of scope.
- **Platform admin.** Reads nothing here: `presby_platform` has no privilege on the table and T24 scans the admin tree. The platform role confers nothing (Two Hierarchies).
- **Deployment.** Additive. Rollback order: the toggle, then close the postings, then `sites.public_render`; no data rollback needed.
- **Org types.** `orgTypes: null`, so a presbytery or synod with a live site can post openings. T6 pins the null.

### Existing tests and specs this change alters (blast radius)

The implementer updates these; QA re-runs them.
- `src/app/api/cron/maintenance/route.test.ts:129-134` (exactly one platform `execute`; the mock has no `transaction`) and `:83-86` (the order of the mocked platform results).
- `src/lib/org-feature-catalog.test.ts:65-70` (the toggle-only list), and re-read `:103-116` and `:119-125` (careers is unscoped and not operator-enabled, so they should stay green).
- `src/lib/org-portal/tiles.test.ts:175-176` (22→23 entries), the expected map near `:322`, the scope loop at `:343` (careers is unscoped, so it should stay green); `src/lib/org-feature-categories.test.ts`, `visible-tiles.test.ts`, `portal-menu.test.ts` and `tile-icons.test.tsx` re-run, since they iterate `PORTAL_TILES`.
- `src/lib/audit.test.ts` (`EXPECTED_ENTRIES`, +3).
- `src/lib/site-urls.test.ts` (interface additions), `src/lib/sites-reserved-paths.test.ts`, `src/app/api/sites/ingest/route.test.ts` (the reserved-page cases).
- `src/app/(public)/site/[slug]/[[...path]]/page.test.tsx` (the closure test may pin the exact slot-key set).
- `src/lib/onboarding/founding-administrator.test.ts:145-245` (the "base nine keys" title and array become eleven), `designation-parity.golden.json` and `designation-parity.db.test.ts`, `founding-administrator-section.test.tsx:60-70` and `:240-262` (keys list and label assertions), `src/app/(admin)/admin/organizations/[id]/page.test.tsx` (mocks the plan; re-run).
- `scripts/test-rls.sql:7911-7912` (template count 6→7): an integration patch, Rule 16.
- e2e specs that exercise code this change touches, re-run in Phase 5, none asserts a string this change alters (grepped): `e2e/public-sites.spec.ts` and `e2e/visual-parity.spec.ts` (`render-site-page.tsx`), `e2e/custom-domains/*` (same render path), `e2e/portal-home-cards.spec.ts` and `e2e/member-home.spec.ts` (home tiles; their organizations have no toggle row, so no new tile), `e2e/invitation-*.spec.ts` and `e2e/designation-revoke.spec.ts` (the bundle; they assert no key list, grepped).

**Flags each new or changed e2e spec depends on.** Each spec sets what it needs through `e2e/support/flags.ts` (capture, set, restore, verified by SELECT); **no key is added to `scripts/ci/e2e-baseline-flags.sql`**:
- `careers.spec.ts`: `sites.public_render` (on; it is in the baseline already, but the spec sets and restores it instead of relying on that), `org_portal.home_v2` (on, for the tile assertion; also in the baseline, set and restored anyway), `org_portal.feature_categories` (on for the category case, restored). Per-organization state (toggle row, category row, site status, bundle) is fixture rows the spec writes and removes, confirmed by SELECT.
- `custom-domains/careers.spec.ts`: `sites.public_render`.
- `hydration/careers-posting-form.spec.ts`: `sites.public_render` is not needed (staff pages only); the spec depends on no global flag.

**Fixture people.** `e2e/support/careers-fixture.ts` reuses the existing `mfa-enrolled` and `congregation-clerk` users and the `giving-fixture.ts` pattern (a throwaway organization with `deletable_until`, fixed child ids, the user linked to a person created for that organization). If Phase 4 finds it needs a person that pattern does not create, it stops and asks the orchestrator for a person-id range (Rule 16).

## Out of Scope (confirm with the user)

- Online applying, the resume store, the reviewer screens, the applicant notification, the Home badge and the retention job: Increments 2 and 3. This increment stores no applicant data and no file.
- Site chrome (top menu and footer) on `/careers` and `/careers/<posting>` (D2, Q-A), and a `presby-site-kit` release (D1, Q-B).
- Postings in the site's `sitemap.xml`, and Google for Jobs structured data (fpcw deferred it). TODO lines below.
- Currencies other than US dollars; employment types beyond the three; pay units beyond hour and year; a hiring-contact field (Q5 dropped it); screening questions (D8 of the schema decisions).
- Hard deletion of a posting (D12), unpublishing a published posting back to a draft, duplicating a posting, scheduled publishing, per-posting analytics, RSS.
- Legacy-URL redirects from the old portal addresses (Track F Increment 2).
- A "which page shows my openings" link check beyond what the bundle contains (the line reports contents, not that a menu points at them).
- Per-organization retention, bulk export, any platform-admin view of careers data.

## Copy

All user-facing strings this increment adds or changes. **An implementer who needs a string that is not here stops for a ruling.** Placeholders are in `{braces}`. Plain wording for non-engineers.

### P — Public (anonymous visitor; the pages and the slot)

| ID | Where | String |
|---|---|---|
| P1 | slot (off or failed); `/careers` and posting page (failed) | "Our job openings aren't available right now. Please check back soon." |
| P2 | empty list | "We don't have any open positions right now. Please check back soon." and, only when the profile has a phone: "You can also call us at {phone}." |
| P3 | `/careers` page | `h1` "Job openings"; line under it: "{Organization}" |
| P4 | each card | link "View this position"; "{Full-time \| Part-time \| Intern}"; "{location}"; pay line (P9); "Posted {Monday, November 3, 2026}"; "Closing date: {Monday, November 3, 2026}" only when set |
| P5 | posting page, under the description | heading "How to apply"; "To apply, please contact {Organization}. You can reach us at {phone}, or through the contact details on our website." (the phone clause only when the profile has a phone; "our website" links to the site home) |
| P6 | closed posting | `h1` the title; "This position is no longer accepting applications."; link "See other job openings" |
| P7 | posting page | links "Back to {Organization}" (to the site home) and "All job openings" (to the back target) |
| P8 | page titles | "Job openings \| {Organization}"; "{Posting title} \| {Organization}" |
| P9 | pay line | "{$45} to {$60} per hour"; "{$52,000} to {$60,000} per year"; "From {$45} per hour"; "Up to {$60,000} per year"; one amount when min equals max: "{$45} per hour". Whole dollars when the cents are zero, else two decimals. No line when no pay was entered |

### S — Staff (`careers.manage` holder at `/o/<slug>/admin/careers/**`)

| ID | Where | String |
|---|---|---|
| S1 | feature off (any viewer) | `h1` "Job openings"; "Job openings aren't turned on for {name} yet." then, only when the viewer holds `org_features.manage`: link "Turn them on under Features"; otherwise: "Ask someone who manages {name}'s features to turn them on." |
| S2 | forbidden | "You don't have permission to manage job openings at {name}. If you think this is a mistake, ask your stated clerk or another administrator there." |
| S3 | load error | "We couldn't load job openings right now. Try again in a moment." and button "Try again" |
| S4 | not found | "That job opening couldn't be found." and link "Back to job openings" |
| S5 | placement line, list page | see below |
| S6 | editor | see below |
| S7 | list | `h1` "Job openings"; "{name}"; button "New job opening"; empty state "You haven't created any job openings yet." with button "Create your first job opening"; sections "Published ({n})", "Drafts ({n})", "Closed ({n})" (Closed is a `<details>`); a row: title (link), badge "Draft" \| "Published" \| "Closed" \| "Never published" (a discarded draft), "{location} · {type}", pay line, "Posted {date}", "Closing date: {date}"; a published row whose closing date has passed: badge "Closing date passed" and "No longer shown on your website. It will be marked Closed automatically."; a published row with no closing date posted 60 or more days ago: "Posted {date} with no closing date. Close it if it has been filled."; buttons "Move up" and "Move down" (accessible names "Move {title} up" / "Move {title} down"; published rows only); link "View on your website" (published and not past its date) |
| S8 | actions and errors | below |

**S5 — placement line** (the four states, from `describePlacement`; {path} is shown as text, e.g. "/employment"):
- Slot found on one or more pages, no page of the site's own at `/careers`: "Your openings appear on your website's {path} page and in a list at {the /careers address}."
- Slot found, and the site has its own `/careers` page: "Your openings appear on your website's {path} page."
- No slot anywhere, no own `/careers` page: "Your openings are listed at {the /careers address}. No other page on your website shows them yet. To put them on a page, ask whoever maintains your website."
- No slot anywhere, but the site has its own `/careers` page: "Your website has its own /careers page, so your list of openings can't appear there. No page on your website shows them yet. To put them on a page, ask whoever maintains your website."
- The published site could not be read (not live, not published, or a read failure): "We couldn't check your published website, so we can't say where your openings appear."

**S6 — editor**
- Labels and hints: "Title"; "Location"; "Type" with options "Full-time", "Part-time", "Intern"; "Pay (optional)" with "Lowest", "Highest" and a unit select "per hour" / "per year" and the hint "Leave blank if you don't want to show pay."; "Short summary" with "One or two sentences shown in the list of openings. Up to 300 characters."; "Closing date (optional)" with "The last day you will accept applications. Leave blank to keep it open until you close it."; "Web address" shown as "…/careers/" followed by the field, with, before first publish, "Used in this opening's web address. Letters, numbers and dashes. This can't be changed after you publish."; after first publish the field is read-only with "The web address can't be changed after an opening is published, because people may have saved or shared it."
- Description: label "Description"; hint "Leave a blank line between paragraphs. Use the buttons to add headings, bold text, lists and links. Pasting from Word or Google Docs keeps headings, bold, italics, lists and links; check the preview afterwards."; toolbar buttons "Heading", "Subheading", "Bold", "Italic", "Bulleted list", "Numbered list", "Link"; counter "{n} of 20,000 characters"; preview heading "Preview"; empty preview "Nothing to preview yet."
- Description errors (each with the line number and the offending text in quotes): "Line {n} ("{snippet}") starts with a single #. Use the Heading or Subheading button for section titles." / "Line {n} ("{snippet}") uses a heading level we don't support. Use ## or ###." / "Line {n}: the link "{label}" isn't a web address we can use. Links can start with https://, http:// or mailto:." / "Line {n}: finish the web address for the link "{label}", or remove the link." / "The description is too long. The limit is 20,000 characters."
- Field errors: "Enter a title." / "Enter a dollar amount like 45 or 52,000." / "The highest pay must be at least the lowest." / "Choose per hour or per year." / "Enter a date." / "The closing date can't be in the past." / "Use letters, numbers and dashes only."
- Buttons: "Save draft" (draft); "Save changes" (published or closed); "Publish"; "Close this opening"; "Reopen"; "Discard this draft".
- Note beside Reopen when the closing date has passed: "Its closing date has passed. Change the closing date, save, then reopen."

**S8 — dialogs, toasts, errors**
- Publish dialog: title "Publish "{title}"?"; body "Anyone on the internet will be able to read this opening on your website. Changes you save later appear right away."; confirm "Yes, publish"; cancel "Keep as draft".
- Close dialog: title "Close "{title}"?"; body "It will come off your website and out of the list of openings. You can reopen it later."; confirm "Yes, close it"; cancel "Keep it open".
- Reopen dialog: title "Reopen "{title}"?"; body "It returns to your website right away, at the top of the list."; confirm "Yes, reopen it"; cancel "Leave it closed".
- Discard dialog: title "Discard this draft?"; body "It moves to Closed and never appears on your website."; confirm "Yes, discard it"; cancel "Keep the draft".
- Toasts (from the **returned** result): "Draft saved." (create) / "Changes saved." / "Published." / "Closed." / "Reopened." / "Draft discarded." Reorder: no toast; a visually hidden live region says "Moved {title} up." or "Moved {title} down."
- Errors: forbidden "You don't have permission to manage job openings." / not found "That job opening no longer exists." / feature off "Job openings aren't turned on." / stale "This opening was changed by someone else after you opened it, so your changes were not saved. Reload the page to see what changed." with button "Reload" / slug taken "Another opening already uses that web address. Choose a different one." / incomplete "Add a {title, summary, location and description — only the missing ones} before publishing." / closing date passed (publish) "The closing date has already passed. Change it before publishing." / closing date passed (reopen) "The closing date has already passed. Change it, save, then reopen." / publish limit "You already have 100 job openings published, which is the most we can show. Close one before publishing another." / invalid transition "That can't be done to this opening right now. Reload the page and try again." / generic "We couldn't save that. Try again."

### F, D, T, R, I, N — other surfaces

| ID | Where | String |
|---|---|---|
| F1 | Features page, toggle name | "Job openings" |
| F2 | Features page, description | "Lets your congregation post job openings on its public website. People are asked to contact the church to apply. Whoever maintains your website can also place the openings on a page." |
| D1 | platform admin, founding-administrator confirm dialog (`PERMISSION_LABELS`) | `careers.manage` → "job openings"; `careers.applicants` → "job applications and resumes". The sentence reads "…they will be able to manage …, website domains, job openings, and job applications and resumes…" |
| T1 | Home tile | label "Job openings"; description "Post and manage job openings for your website." |
| R1 | permission catalog | `careers.manage`: "Create, edit, publish and close this organization's job openings". `careers.applicants`: "Read and remove job applications, and download applicants' resumes" |
| R2 | role template name | "Hiring Committee" |
| I1 | ingest error for a reserved careers page | "Page "{path}" is reserved: PresbyPortal serves its own pages for job openings under /careers/ (on a custom domain too). A page at /careers itself is fine. Rename or remove it." |
| N | release notes (starting text) | below |

**N — release-note lines**
- Congregations can now post job openings on their public website. Staff with the new permission to manage job openings write an opening in a simple editor with headings, bold, lists and links, preview it, publish it, set a closing date, and put the openings in the order they want. Text pasted from Word or Google Docs is converted for them.
- Visitors see the list of openings and each opening on its own page, on the church's PresbyPortal address and on its own domain. Whoever maintains the church's website can also place the list on any page.
- Applying online is not part of this release. Each opening tells visitors to contact the church to apply.
- It is off until an administrator turns on "Job openings" under Features.
- A congregation's founding administrator receives two new permissions automatically: one to manage job openings and one that will allow reading job applications once online applying arrives. There is also a new "Hiring Committee" role to adopt from the Roles page.
- A page on a church's own website can no longer be placed below /careers/ (PresbyPortal uses that space for openings). A page at /careers itself still works and is shown in place of the list.

### The four checks, one line per string group

- **P (public).** *Residuals:* P1 uses one string for the two causes the slot cannot tell apart, as DECISION-154 requires; nothing in P denies the free-text-is-public fact (the editor side says it, S6/S8) or claims privacy. *Source of truth:* P1 asserts only unavailability (the definer's collapse or the reader's catch); P2 asserts "no open positions right now", established by a **successful** `available` read whose `postings_json` is empty at the moment of the read (not a history, hence "right now"); the phone is `organization_profiles.phone` and the words say "us", not "the office" (D9); P4's "Posted" is `posted_on` and "Closing date" is `closing_date`; P5 asserts only that the church can be contacted and gives the phone only when the profile has one; P6 asserts "no longer accepting applications", established by `closed` (the stored status or the passed closing date, both read by the definer); P9 is the stored pay fields. *Audience:* every P string is read by an anonymous visitor; "check back", "call us" and "contact … through our website" are things a visitor can do (the site home is linked). *Neighbours:* grepped `src`, `e2e`, `scripts`, `docs/product` and `docs/release-notes` for career, job opening, employment, hiring, applicant, resume and apply (case-insensitive): the only hits are staff and personnel code comments (`staff/actions.ts`, `staff.ts`, `people.ts`, `db/domain/staff.ts`), which describe hiring a *staff member into the roster*, not these openings; **no live user string about openings exists** to go stale.
- **S (staff).** *Residuals:* nothing denies the verbatim-public fact, and the publish dialog says anyone on the internet can read it; no string claims secrecy for drafts (see the draft residual) or permanence of removal. *Source of truth:* S7's badges are the stored `status` and `first_published_at`; "Closing date passed" is `closing_date < orgToday` read in the same transaction; the 60-day hint is `posted_on` and a null closing date; S5's claims are the published bundle's contents, and the line says "appear" only for a page whose blocks carry the slot, and says it could not check otherwise; the toasts report the **returned** status, and "Published." does not claim the website shows it (the toggle is on or the page would not have loaded, but the site may not be live; the dialog says "will be able to"). *Audience:* every S string is read by a `careers.manage` holder except S1 and S2, which any member may see: S1's Features link is rendered only when the same transaction found `org_features.manage`, and its other branch tells everyone else to ask, which anyone can; S2's "ask your stated clerk or another administrator" is an instruction a plain member can follow; S5's "ask whoever maintains your website" is a request the reader makes, not an action in the tool. *Neighbours:* the Staff page's own hint ("Granting software access … is done separately") is about staff positions and stays true; the Features page's category-off line "Turn on {category} above to enable this" is the existing generic string and the definer now honours it.
- **F, T (toggle, tile).** *Residuals:* F2 does not claim the list shows everything or that applying is online. *Source of truth:* F2 and T1 are generic and assert nothing about one congregation's state. *Audience:* F2 is read by an `org_features.manage` holder, who can do the one thing it says ("place the openings" is a request to the website maintainer); T1 is read by **every member** on Home, so it names no permission and no instruction. *Neighbours:* the same-subject strings are none (grep above). **Strings Increment 2 will make stale** and must modify (listed now so its Phase 3 starts from them): F2's "People are asked to contact the church to apply"; T1's description; P4's "View this position" (becomes "View and apply"); P5 and the whole "How to apply" block; the S8 close and reopen dialogs (they will need the retention sentences); R1's `careers.applicants` description is already written for Increment 2 and is *inert wording* until then.
- **D, R (designation dialog, catalog).** *Residuals:* D1 tells the platform administrator, in plain words, that the founding administrator will manage "job applications and resumes": it names the accepted residual (DECISION-265) rather than hiding it. *Source of truth:* the dialog's key list is `foundingAdministratorPlan()`, pinned equal to the SQL function for every organization type (T7); the label map has a test that no raw key renders. *Audience:* a platform administrator inviting a founding administrator. *Neighbours:* `invite-summary.tsx:10` ("manage people, roles and settings") is generic and stays true; `designation-holder-copy.ts` mentions roles only.
- **I (ingest).** *Residuals:* none touched. *Source of truth:* the reserved rule in `reservedSitePath()` (a first segment `careers` with a descendant). *Audience:* a site author reading the CI log, who can rename or remove the page. *Neighbours:* the existing two branches at `ingest/route.ts:115-117` ("PresbyPortal serves its own /{segment} path") would have said `/careers` itself is reserved, which is false; the new branch is added and the old text is left for the other segments.
- **N (release notes).** *Residuals:* line 5 admits the founding administrator receives the permission that will let them read applications, so the note does not deny the accepted residual; line 3 says applying online is not included. *Source of truth:* each line is a property of the shipped code, pinned by T1, T4, T8, T11, T19, T25. *Audience:* congregation administrators and staff. *Neighbours:* none.

## Carry-forward

Every Phase 1 gap and question, every Phase 2 ruling, Note and finding, and every operator ruling. *Deferred* means the architect's three-increment split (Phase 2) with the operator's Q-defaults; the receiving increment's Phase 3 designs it.

| Phase 1 gap / Phase 2 ruling | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| G1 resume storage | *Deferred to Increment 2* (architect increment split). Inc 1 stores no file; no `blob_assets` use; DECISION-263 applies from Inc 2 |
| G2 request-size ceiling | *Deferred to Increment 2*. No upload in Inc 1; `serverActions` untouched |
| G3 redaction vs soft delete | *Deferred to Increment 2/3*. Inc 1 stores no applicant data. The sweep return type is shaped for Inc 2's redaction rows (D6) |
| G4 permission bootstrap | Addressed: Permissions & Flags, Data Model 2 and 3, T1, T7 (the three places move together) |
| G5 tile and badge | Tile addressed (Component plan, T22); badge and `annotations` prop *deferred to Increment 2* (architect) |
| G6 rich text | Addressed with D1: `Prose`, the validator, the toolbar, the paste converter, T8–T11 |
| G7 notifications | *Deferred to Increment 2* (no applicant email, architect). Inc 1 sends no email |
| G8 URL and reserved paths | Addressed: routes, `SiteUrls`, descendants-only reservation, slot (API Contract), T18, T19, T25 |
| G9 closing dates and time zones | Addressed: org-zone `date`, derived open predicate, sweep (Edge Cases), T3–T5. The apply handler's own check is Inc 2 |
| G10 admin visibility and empty states | Addressed with D8: Copy S5 and S7, T20 |
| G11 mobile and accessibility | Addressed for the pages in scope: 44px targets, 16px textarea, wrapping, T25/T26 at 360px. The apply form's rules are Inc 2 |
| G12 2FA mid-enrolment | No change needed (Phase 1): staff pages are under `/o/*`, the public tree has no session |
| G13 Track K | Post-ship note below (postings only); applicants not imported (Q11) |
| G14 pre-hydration and form reset | The staff form is behind `HydrationGate` (T21, T27). The apply form is *deferred to Increment 2* |
| Pass 5: redirect targets | Addressed: no `next` or `callbackUrl` on any careers route; links come from `SiteUrls`; link allow-list (T8, T17, T19) |
| Pass 5: state-machine shortcuts | Addressed for postings: edges in the trigger and the lib, identity never from a form field, org from the session (T3, T15). The applicant-side shortcuts are Inc 2 |
| Pass 5: enumeration | Addressed: one `unavailable` row, one 404 (T4, T25) |
| Pass 5: input boundaries | Addressed for staff input: lengths, NFC, control and bidi stripping, `z.guid()` (T8, T12). Applicant input is Inc 2 |
| Pass 5: file type and size, malware | *Deferred to Increment 2* |
| Pass 5: spam and resource abuse | Staff-only writes need an authenticated manager; the public reads are anonymous reads like every site page, one definer call. Anonymous-write defences are *deferred to Increment 2* |
| Pass 5: email abuse, PII in logs and audit | No email in Inc 1. Logs carry the slug only; audit rows carry ids only (T16, T15) |
| Pass 5: retention defeat | *Deferred to Increment 2/3* |
| Pass 5: self-targeting, permission separation | Separation addressed: the two keys are independent and `careers.applicants` alone cannot manage (T15). The rest is Inc 2 |
| Pass 5: platform hierarchy, cross-tenant | Addressed: no platform privilege, T24 scan; cross-org reads in both directions (T2, T4) |
| Pass 5: content injection | Addressed: React text only, link allow-list, no auto-links (T9, T17, T24) |
| Q1 file format and size | *Deferred to Increment 2* (operator: PDF and .docx, 4 MB) |
| Q2 retention mechanics | *Deferred to Increment 2/3* (operator ruling recorded in the parent) |
| Q3 tier and 2FA | Applied: `careers.applicants` tier 3, `requires_two_factor` false (Permissions & Flags, T1) |
| Q4 bootstrap | Applied (operator ruling): the bundle in three places, the template (Data Model, T1, T7) |
| Q5 notification | *Deferred to Increment 2*; hiring-contact field dropped (Out of Scope) |
| Q6 applicant confirmation email | Resolved by the architect: dropped. Nothing here |
| Q7 bot protection | *Deferred to Increment 2* |
| Q8 URL shape | Applied on the analyst default: `/careers`, `/careers/<posting>`, slot `careers`; the church's own page name ("Employment") is the site author's, below |
| Q9 audit scope | Applied for Inc 1: publish, close, reopen, and the cron close; download and redaction rows are Inc 2 |
| Q10 applicant list views in the audit | *Deferred to Increment 2* (default no) |
| Q11 Track K applicants | Applied: not imported; postings-only import note below |
| Q12 statuses | Applied: draft, published, closed, reopen allowed, plus discard (D12) |
| Phase 2 Verdict: own table, route-handler upload, no applicant email, retention with apply | The three that concern applicants are *deferred to Increment 2* (architect). The reorder of increments is followed: this is Increment 1 |
| Phase 2 Placement: schema split, 0071/0072 | Applied with the orchestrator's number: 0071 here, **0075** for Increment 2 (orchestrator note). Fallback not needed |
| Phase 2 Placement: file list | Followed; additions are `placement.ts`, `placement-read.ts`, `sweep.ts`, `slug.ts`, `dates.ts`, `text.ts`, `contract.ts`, `input.ts`, and `src/components/careers/` |
| Phase 2 Server/client split | Followed: client islands are the editor, the form, the status controls and the move buttons; everything else is a Server Component. The apply form's island is Inc 2 |
| Phase 2 Dependencies: none new | Honoured. No dependency added; no zip library needed (Inc 2) |
| Invariant: Isolation | Applied: FORCE RLS, `tenant_isolation`, composite-key target, no platform privilege. The definer-only applicant tables are Inc 2 |
| Invariant: Never Hard-Delete, all deletes soft | Applied: no DELETE grant, delete guard, D12. The applicant file exception is Inc 2 |
| Invariant: No role carries a wildcard | Applied: the bundle change in three places, residual recorded (DECISION-265, CLAUDE.md sentence at ship) |
| Invariant: Permissions vs Flags | Applied: toggle only, no flag, gate order |
| Invariant: Two Hierarchies | Applied: T24; audit rows carry ids only (T15); no applicant data exists yet |
| Invariant: A Custom Host Is a Key | Applied: no cookie, no `/api`, canonical from `urls`, `redirectIfNeeded` (T18, T26) |
| Invariant: The Brand Is a Cascade Override | Honoured: renders only in the two brandable groups; no `<style>` element; `check:brand-scope` unchanged |
| Invariant: The Proxy Does Not Reach the Database | Honoured: `src/proxy.ts` untouched |
| Invariant: Verify in a Browser / HydrationGate | Staff form gated (T21, T27); the apply form's `method="post"` rule is Inc 2 |
| Ruling G1 (table, serving) | *Deferred to Increment 2* |
| Ruling G2 (route handler, 4 MiB) | *Deferred to Increment 2* |
| Ruling G5 (badge) | *Deferred to Increment 2* |
| Ruling G6 (markdown subset, no editor dependency) | Applied, with the D1 correction (`Prose`, not `renderMarkdown`) |
| Ruling G7 (notifications, `email_queue`) | *Deferred to Increment 2* |
| Ruling G8 (URLs, reserved paths) | Applied; D2 and D4 refine it |
| Retention function and cron (F295, no new cron) | The v1 step is applied (isolated `try`, platform connection, after the reconcile, T23); redaction is *deferred to Increment 2* |
| Tier 3 and 2FA | Applied (above) |
| 0057-style backfill | Applied (Data Model 2, T1) |
| Increments | Followed. Increment 1 = 0071; Increment 2 = 0075 |
| Note 1 (submit definer) | *Deferred to Increment 2* |
| Note 2 (form token) | *Deferred to Increment 2* |
| Note 3 (file checks) | *Deferred to Increment 2* |
| Note 4 (slug immutable after publish; version compare-and-set) | Applied: trigger and lib (Data Model 5, T3, T15, T25) |
| Note 5 (Turnstile on a custom host) | *Deferred to Increment 2* (no form here) |
| Note 6 (copy must not deny residuals) | Applied: no retention or erasure wording in Inc 1; the four checks above. The Neon-branch warning is in Implementation Order |
| Note 7 (ship-time documentation) | Split by increment (D11); Inc 1 items under Integration |
| Note 8 (shared files; `test-rls.sql` additions) | The shared files are untouched (Integration items). The three applicant additions are Inc 2; Inc 1's are T1–T5 and the 6→7 count patch |
| F289 (public asset route) | Not this pipeline: its own bug-fix pipeline (orchestrator opened `2026-10-25-public-asset-allowlist`). Careers does not depend on it |
| F290, F294 | Resolved by Inc 2's design (architect); nothing in Inc 1 |
| F291 (ticket forms' 10 MB claim) | Not this pipeline: queued by the orchestrator |
| F292 (permission bootstrap) | Addressed: three places, T7, DECISION-265 |
| F293 (audit IP and user agent on applicant events) | No applicant events in Inc 1; staff rows carry the staff member's IP only (existing behaviour) |
| F295 (retention ceiling) | *Deferred to Increment 2/3* |
| DECISION-262 | Inc 2's |
| DECISION-263 | Inc 2's; Inc 1 makes no `blob_assets` use |
| DECISION-264 | Applied for the public surface; amended (below) |
| DECISION-265 | Applied; amended (below) |
| DECISION-266 | Applied with the D1 correction (below) |
| Operator ruling: redact and destroy file bytes | *Deferred to Increment 2/3* (nothing to redact here) |
| Operator ruling: both keys in the founding-administrator bundle | Applied |
| Operator ruling: PDF and .docx, 4 MB | *Deferred to Increment 2* |
| Orchestrator: Inc 2 migration is 0075 | Recorded in Names and Carry-forward; this migration claims only 0071 |
| Orchestrator: F289 and F291 as separate pipelines | Noted; no dependency |

## Findings (this phase)

The pre-assigned F289–F295 are all used by Phase 2. These are labelled P3-n; the orchestrator assigns F-numbers when it integrates.

- **P3-1.** Phase 2 G6's premise is wrong: `presby-site-kit@4.0.0` does not export `renderMarkdown` (`exports` map: `.` and `./styles.css`; the index re-exports no markdown symbol). `Prose` is exported and calls it. Resolved by D1; the architect's intent (one renderer shared with bundle prose blocks) is preserved. Option for later: a `presby-site-kit/markdown` subpath export (site-kit v4.1.0) would let the editor preview import only the renderer. Operator question Q-B.
- **P3-2.** site-kit's stylesheet is keyed on a `.presby-site` ancestor and sized for the reference site (prose `h2` is 4.25rem). A posting description cannot render inside site chrome without giant headings, so the platform pages use their own wrapper (D2).
- **P3-3.** `src/app/api/cron/maintenance/route.test.ts:129-134` pins exactly one platform-connection `execute`; adding a platform step breaks it (listed in the blast radius).
- **P3-4.** `scripts/test-rls.sql:7911-7912` asserts six template roles; the new template makes it seven (integration patch).
- **P3-5.** The platform admin's founding-administrator confirm dialog builds its sentence from `PERMISSION_LABELS`; an unlabelled key would render raw (`careers.applicants`). Labelled in D1 of the Copy; the existing drift test is extended.
- **P3-6.** The ingest error for a reserved segment would say `/careers` itself is reserved, which the descendants-only rule makes false (Copy I1).
- **P3-7.** `rel="noopener noreferrer nofollow"` (Phase 1 Pass 5) is not producible through `Prose`; no link opens a new tab and the author is staff, so noopener is moot and nofollow is accepted as absent (D10). *Accepted, paper.*
- **P3-8.** The markdown renderer has no escape syntax, so a literal `*` or a line-leading `- `, `1. ` or `#` in typed text changes meaning. The paste converter neutralises `*`; typed text relies on the preview. *Accepted residual.*
- **P3-9.** The pilot congregation's site repo has **no Employment page** today (14 pages, none for employment). The "integration step" is therefore a new content file, not an edit (post-ship steps below).
- **P3-10.** Silent truncation: a public list capped at 100 with no cap on published rows would drop the 101st. Closed by D13 (trigger-enforced cap).

## Decision drafts (for `docs/decisions.md`; the orchestrator writes them at integration)

**DECISION-264 (amendment, Increment 1 part) — The careers public surface.** `/careers/<posting>` is a dynamic segment under the site tree; `/careers` lets the bundle's own page win; the reserved-path check gains descendants-only reservation (`careers/<anything>`; exact `careers` allowed). The pages are platform pages shaped like `/give` (brand tokens, back link, no site chrome, D2). One definer, `presby_public_careers(slug, posting)`, answers both reads, always returns one row, projects named keys only, and returns `slug` and `title` alone for a closed posting. A failed read is a `failed` state, distinct from `unavailable`: the slot shows one notice for both, the pages 404 for `unavailable` and show a noindex notice for `failed`. "Open" is derived at read time (`published` and closing date not passed in the organization's zone); the sweep is housekeeping, not the gate. The sweep's return type is fixed now so Increment 2 can extend it with `create or replace`. *Revisit if* a church wants its site's menu on these pages (needs a site-kit change, Q-A), or the public list needs more than 100 rows.

**DECISION-265 (Increment 1 part) — Careers permissions.** `careers.manage` (tier 1) and `careers.applicants` (tier 3); neither implies the other; both are in the founding-administrator bundle in the SQL function, the TypeScript plan, the parity golden and a 0057-style backfill, and in a universal `hiring_committee` template inserted by key (no fixed id). The bundle change is the first key above tier 1 in that bundle; accepted `paper` residual, operator ruling Q4: the founding administrator can read applications, detected by the resume-download audit row (Increment 2). Until Increment 2, `careers.applicants` is checked by no code. *Revisit if* the S2 follow-up (`requires_two_factor` on tier-3 keys) is decided; it is a one-column change.

**DECISION-266 (amendment) — Posting descriptions use the site-kit markdown subset.** Rendered by `<Prose>` (exported) because `renderMarkdown` is not. No editor dependency (Tiptap and ProseMirror rejected: a second content model on the public tree). The server validator is strictly narrower than the renderer: http, https and a bare mailto only, headings `##` and `###` only, no placeholder links. The editor is a textarea with a toolbar, a client preview through the same component, and a paste converter built on the browser's `DOMParser` that flattens to the subset. *Revisit if* site-kit exports a `./markdown` subpath, or staff feedback says the toolbar is unusable.

**DECISION-NNN (implementation entry; the orchestrator assigns the number) — Careers Increment 1 implementation shape.** Names (Names table). Posting state machine: draft→published, draft→closed ("discard"), published→closed, closed→published, enforced by a trigger that binds the owner too, with `first_published_at`, `posted_on`, `closed_at`, `version` and `updated_at` trigger-owned and outside the tenant column grants. Compare-and-set on `version`, which only content and status bump. Only published postings are ordered, newest first, by dense renumbering under a row lock. At most 100 published postings per organization, by trigger and advisory lock. A posting is never deleted. Audit rows for publish, close, reopen and the cron close, in the change's transaction, ids only; none for create, edit, reorder or discard. The sweep runs as an isolated step of the existing daily maintenance cron on the owner connection, after the roll reconcile. The placement line reports the published bundle's contents and says it could not check otherwise. The owner path may set `posted_on` at first publish (Track K import). *Revisit if* the 100 cap or the three employment types prove too tight, or a fifth writer of `job_postings.status` appears (it must audit).

## Integration items for the orchestrator (Rules 10, 14, 15, 16)

Shared files this pipeline does not edit: `drizzle/meta/_journal.json` (entry for 0071), `scripts/test-rls.sql` (apply `scripts/careers/test-rls.sql.integration.patch`: the `\ir careers/test-rls-71.sql` and the 6→7 template count at `:7911-7912`), `scripts/seed-dev.sql` (optional: `scripts/careers/seed-dev-careers.sql` is an owner fixture), `src/lib/db/domain/index.ts` (add `export * from "./careers";`), `docs/decisions.md` (DECISION-264/265/266 amendments and the implementation entry above), `docs/STATE.md`, `docs/TODO.md`, `docs/schema-design-2.md` if findings are folded there (P3-1 to P3-10), the e2e support files this pipeline adds.

**`CLAUDE.md` edits at ship (Increment 1):**
1. Project Layout, after the `src/lib/contact-methods/` entry:
```
src/lib/careers/       — job postings (Track L): the pure description validator,
                         toolbar and paste converter; postings.ts (staff reads and
                         writes, audit in the same transaction); public.ts (the one
                         anonymous definer read); sweep.ts (the owner-only
                         auto-close, the only getPlatformDb() user here).
                         Applications arrive in a later increment and are
                         definer-only
src/components/careers/ — the posting description, list and meta pieces shared by
                         the public tree and the staff preview
```
2. Key Invariants → No Role Carries a Wildcard, after the "Known violation" paragraph: "*Second known violation:* the founding-administrator bundle carries `careers.applicants`, a tier-3 key (DECISION-265, operator ruling; the first key above tier 1 in that bundle). The founding administrator can read job applications once they exist; the key reads nothing until the applications increment ships, and that increment's resume-download audit row is what detects use. `paper`."

**`docs/TODO.md` lines to add** (checkbox style as the file uses):
```text
- [ ] **Careers: postings in the site's `sitemap.xml` and Google for Jobs structured data.** Open postings are public pages but the sitemap lists only bundle pages. Needs the sitemap route to read the open list through `presby_public_careers`, and JSON-LD on the posting page. fpcw deferred the structured data too. — careers Inc 1 Out of Scope
- [ ] **Careers pages carry no site menu or footer (D2).** They look like `/give`: brand colours and fonts, a back link. Closing it needs site-kit to scope its prose typography so a posting description can render inside the chrome, or a `./markdown` export; then the platform pages could render through `renderSiteBundle` with a synthetic page. — careers Inc 1 D2, P3-2
- [ ] **site-kit: export `renderMarkdown` as `presby-site-kit/markdown` (v4.1.0).** Lets the careers editor preview import only the renderer instead of the whole kit. — careers Inc 1 P3-1
- [ ] **Careers: legacy-URL redirects from the old portal's `/careers/<slug>` addresses.** Belongs with Track F Increment 2. — careers Inc 1
- [ ] **Careers: employment types beyond full-time, part-time and intern; pay units beyond hour and year.** Additive CHECK widening if a church asks. — careers Inc 1 Data Model
```
Amend the Track L line: Increment 1 shipped on SHIP IT; Increments 2 and 3 open. `docs/product/functionality-map.md` (Rule 14): add a careers bullet (postings, the editor, the public routes and slot, `job_postings` migration 0071, `org_portal.careers`, `careers.manage`/`careers.applicants`, the bundle and template, DECISION-264–266) and a line to the index. `docs/architecture.md`: **not** at this increment (Rule 15).

**Pre-deploy check, production, read-only (Phase 2 Note on reserved paths; run by the operator, *syntax unverified until Phase 4 runs it on the branch, expected 0 rows*):**
```sql
select o.slug, p->>'path' as path
  from organization_sites s
  join organizations o on o.id = s.organization_id
  join blob_assets b on b.id = s.content_bundle_key
  cross join lateral jsonb_array_elements(convert_from(b.bytes, 'UTF8')::jsonb -> 'pages') p
 where lower(p->>'path') like '/careers/%';
```
Any row is a live bundle page the new route would shadow.

## Post-ship steps (not platform code)

**Public-site integration for the pilot congregation's Employment page** (the site repo is private, `site-fpcw`; this is a content step for the site author, after Inc 1 ships and the church has turned the toggle on and published at least one opening; doing it earlier would show Copy P1 on a menu page). Create `content/employment.json` with `frontMatter`: `title` "Employment", `navLabel` "Employment", `navGroup` "Connect", `navOrder` 26 (between Contact at 25 and Give at 40); `blocks`: a `hero` with heading "Employment", an optional `prose` introduction written by the church, and `{"type":"liveSlot","props":{"slot":"careers"}}`. Push to `main` (the ingest workflow does the rest). Verify on the platform address and on the church's own domain at 360px: the list shows inside the site's menu and footer, a card opens the posting page, "Back to {church}" returns. The platform list at `/careers` also works without this step. Link the church's old website's Employment page to the new address when Track F cuts over.

**Track K posting import note (a one-time script in private notes, no real data in the repo).** Import fpcw `job_postings` rows (draft, published and closed) through the owner connection, in this order per row: insert as `draft` with the mapped fields, then `update … set status = 'published', posted_on = <original posted_date>` (the trigger lets the owner supply `posted_on` at first publish), then for a closed row `update … set status = 'closed'`. Mapping: `title`, `location`, `summary`, `slug` (kept so old links can be redirected later), `closing_date` and `sort_order` carry over; `employment_type` `full-time`/`part-time`/`intern` → `full_time`/`part_time`/`intern`; `pay_min`/`pay_max` numeric dollars → integer cents, `pay_unit` `hourly`/`annual` → `hour`/`year`; `description_html` → `description_md` by running **this increment's `htmlToMarkdown`** in Node with jsdom, so the import produces exactly what a paste would, then `validateDescription` on the result (rows that fail are listed by id for hand editing); `hiring_contact_member_id` is dropped (Q5). `closed_at` is stamped at import time (the sweep, not the importer, owns it). Do **not** import applications (Q11); the church's own Drive files and fpcw's retention clock end at cutover, so export a non-PII list (application id, posting id, purge date, Drive file id) for the church to delete against. The import runs after the toggle is on and before the Employment page goes live; verify counts only (rows by status), never content, in anything written down.

**Handoff to Increment 3's runbook (header only there):** how a committee gets access (the founding administrator adopts "Hiring Committee" at Roles → New role, then grants it to the committee's group so membership drives access), the pre-deploy production check above, and the rule never to branch production for pipeline work.

## Operator and orchestrator questions

**For the operator (non-blocking: the design proceeds on the stated default).**
- **Q-A. Site menu and footer on the openings pages.** The openings list and each opening will look like the Give page: your church's colours and fonts, and a "Back to {church}" link, but not the website's top menu and footer. Putting them inside the website's frame needs a change to the site kit's styling (an opening's headings would otherwise render at the size the first customer's site uses for page titles). Default: ship as designed; the list can also sit inside the menu and footer on a page the site author adds (the slot does). Is that acceptable for launch?
- **Q-B. A site-kit release.** Do you want `presby-site-kit` v4.1.0 with a `./markdown` export so the editor preview is lighter? Default: no; Increment 1 works without it, with a measured cost on one admin route.

**For the orchestrator.**
- Assign a DECISION number for the implementation entry and F-numbers for P3-1 to P3-10 (or fold the small ones into one finding).
- Confirm no other pipeline is changing `presby_founding_administrator_permission_keys()` (none was, in all eight sibling worktrees, on 2026-10-25), and sequence merges so the later one re-reads the live body.
- No person-id range is needed unless Phase 4 reports otherwise (fixture reuses existing users).
- Run the production pre-deploy check above (or ask the operator to).

## Implementer

**database-admin** for Batch 1 (migration 0071, the Drizzle mirror, `scripts/careers/`, the `proacl`/`proconfig`/constraint/trigger/column-privilege re-reads, and the founding-administrator bundle's TypeScript, golden and tests so the parity test is green at the batch boundary), then **api-developer** for Batch 2 (pure libs, the reader and the staff lib, catalog, audit, `SiteUrls`, reserved paths, the cron step and actions, with their unit and DB tests), then **ux-developer** for Batch 3 (staff pages and editor, public routes, slot and components, the tile, the three e2e specs, and the browser checks at 360px on both host modes). Reason for the three-way split: the definers, grants and triggers are the artifacts where a mistake is a disclosure, and the database review is a distinct skill; the lib is a contract the UI consumes; and the editor and public pages are the phone-sensitive part.

---

# Phase 4 — Implementation

Each implementer's section follows the `docs/work-log/_template.md` Phase 4 format (files, schema changes, audit events, deviations from this design, gates with counts, strings added or changed with file:line). Judgment output is recorded verbatim.

## Phase 4 — Batch 1 (database-admin)

**Date:** 2026-10-25. **Commits:** `aa4d4da` (work-logs, after `git merge main`: a fast-forward to `2a25584`, no conflicts), `dcbb94a` (this batch). **Neon branch:** `pipeline-careers` (`ep-crimson-tooth-axmvfam4`); development and production untouched.

**Feasibility re-run after the merge:** holds. Main adds no migration past 0064 and does not touch `presby_founding_administrator_permission_keys()`. Its live body on the branch was 0059's. `organization_settings.time_zone` is `not null default 'America/New_York'`. `organizations.status` has no CHECK. `org_portal.feature_categories` is off on the branch. No founding_administrator role exists on development, so the backfill matches 0 rows there. The template count is still 6 before 0071, at `scripts/test-rls.sql:7911-7912`. The neondb_owner role has BYPASSRLS, which the sweep definer relies on.

### Files Created

- `drizzle/0071_presby_careers.sql`: the migration (sections 1-8 as designed).
- `src/lib/db/domain/careers.ts`: the Drizzle mirror (`jobPostings`). It has no `$onUpdate` on `updatedAt`, because presby_app holds no UPDATE on it.
- `src/lib/db/domain/careers.db.test.ts`: owner-path tests (20).
- `scripts/careers/test-rls-71.sql`: the presby_app suite (84 assertions, sections a-f = T1-T5).
- `scripts/careers/seed-dev-careers.sql`: the owner fixture.
- `scripts/careers/test-rls.sql.integration.patch`: the `\ir` line and the template count change from 6 to 7.
- `scripts/careers/seed-dev.sql.integration.patch`: the `\ir`. Not optional: test-rls-71 needs the fixture's two live sites.
- `scripts/careers/_journal.json.integration.patch`: `{ idx: 71, tag: "0071_presby_careers" }`.
- `scripts/careers/domain-index.ts.integration.patch`: `export * from "./careers";`.

### Files Modified

- `src/lib/onboarding/founding-administrator.ts`: `careers.manage` and `careers.applicants` after `domains.manage` (F292 comment).
- `src/lib/onboarding/founding-administrator.test.ts`: the base list grows from 9 to 11 keys, and the presbytery list to 12. The "never carries" title is corrected, because the bundle now carries one tier-3 key. New careers describe block (each key once, the order after `domains.manage`, no office binding).
- `src/lib/onboarding/designation-parity.golden.json`: regenerated with `WRITE_DESIGNATION_GOLDEN=1` under operator ruling Q4 and DECISION-265. Before regeneration, the old golden failed all 8 founding scenarios as expected. The diff is +16 lines, only `careers.applicants` and `careers.manage` in the 8 `founding_administrator` permission lists. Treasurer entries are unchanged.
- `src/app/(admin)/admin/organizations/[id]/founding-administrator-section.tsx` and `.test.tsx`: the Copy D1 labels, a check for the sentence, and a drift guard against raw keys. Proven failing-first: without the labels, the test "names the actual permission list" fails.
- `docs/work-log/2026-10-25-careers.md:281`: a same-line `<!-- leak-ok -->` on the analyst's short-address bypass-payload example (not an address). `check:secrets` flagged it, and the visible text is unchanged.

### Schema Changes

- New: `job_postings` (22 columns, 15 CHECKs, `job_postings_id_org_key`, `job_postings_org_slug_key`, two indexes, three guards, FORCE RLS + `tenant_isolation`). New functions: `presby_careers_org_today(uuid)`, `presby_public_careers(text, text)`, `presby_careers_sweep(integer)`. Re-created: `presby_founding_administrator_permission_keys(text)`. Catalog rows: `careers.manage`, `careers.applicants`. Template: `hiring_committee` with both keys.
- Applied via: **hand-written** migration, `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0071_presby_careers.sql` (owner, direct endpoint). The whole file was applied twice: both runs exited 0, with identical counts (2 catalog rows, 1 template, 2 template bindings, 3 triggers, constraints unchanged). Each failing-first restore below re-applied the whole file once more (about 20 runs, all exit 0). Re-applying also corrects a hand-added grant, which proves the revoke-then-grant against drift. The journal entry is staged as a patch, as is house practice since `db:migrate` stopped tracking past idx 9.
- Catalog re-read on the branch (not from the DDL text). `proacl`: the sweep, the guards and the bundle function are `{neondb_owner=X}` only. `presby_public_careers` and `presby_careers_org_today` are owner + presby_app. All seven functions have `proconfig = {search_path=public, pg_temp}`. `prosecdef` is true for the four definers and false for the three guards. `relforcerowsecurity = t`. The one policy has both clauses. Triggers are enabled `O`. presby_app's column privileges are exactly the design's 13 INSERT and 13 UPDATE columns, plus table-level SELECT. presby_platform and PUBLIC have nothing.
- Local apply for the next implementer: `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0071_presby_careers.sql`, then `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/careers/seed-dev-careers.sql` (both already applied on `pipeline-careers`).

### Audit Events

- None in this batch (a migration is provisioning). `CAREERS_POSTING_PUBLISHED/CLOSED/REOPENED` and the sweep's rows are Batch 2's.

### Deviations from the design (each restated, and the restatement checked against the intent)

1. **`job_postings_complete_when_live` is `status <> 'published' or (summary, location, description non-blank)`, not `status = 'draft' or …`.** The design's form refused the draft → closed "discard" edge for an incomplete draft, which is exactly the draft somebody wants to throw away. The lib would have got an unmapped 23514 on discard. In English, the constraint is: "a posting the public can read in full is complete." Only a published row exposes those fields, because a closed row projects slug and title only. Reopening a blanked closed posting is still refused, by the CHECK and by the lib's `incomplete` check first. Pinned by 71d "an incomplete draft can be discarded".
2. **`created_by` and `updated_by` reference `users(id)` with NO ACTION, not `ON DELETE SET NULL`.** A set-null cascade is an UPDATE, which the guard refuses for the immutable `created_by`, so a user delete would have failed on that path anyway. There is no orphan-recovery surface (database-admin `onDelete` rule). Every comparable provenance column (`events.created_by`, `giving_gifts.recorded_by`, `organization_domains.created_by_user_id`) is NO ACTION.
3. **The fixture organizations are Fernwood and Marrowbone, not Bramblewood and Fernwood.** A full integrated run showed that a Bramblewood site row breaks `giving/test-rls-46.sql` 46l (Bramblewood's giving config must be byte-identical `absent`) and `domains/test-rls-47.sql` 47m (Bramblewood reads NULL site status). Neither assertion mentions careers. Fernwood is now the main fixture and Marrowbone the cross-org one. No suite asserts that either has no site.
4. **The owner-path halves of T3, T4 and T5 live in `src/lib/db/domain/careers.db.test.ts`, not `test-rls-71.sql`.** presby_app cannot act as the owner, so the domains (47) precedent applies. The DB test covers the guards on the owner path, the teardown cascade, two concurrent publishes for the 100th place, the 100-row list limit (guards disabled inside a rolled-back transaction, and re-asserted enabled after), an inactive organization, the sweep's behaviour, and the backfill re-run from the migration's own text against a real founding_administrator role. That last item is needed because the 71b backfill check is vacuous on development, which has 0 roles.
5. **`presby_careers_sweep(null)` means 200 (`coalesce`), not 1.** The design's `least(greatest(p_limit, 1), 1000)` maps null to 1. A null limit from a caller bug should behave like the default. 0 and negatives clamp to 1, and the 1000 ceiling is unchanged.
6. **presby_app cannot INSERT `id`** (it is not in the grant, as designed), so the suite captures ids into transaction-local GUCs rather than using fixed ids. Note for Batch 2: `createPosting` must use `returning id`.
7. **The inactive-organization case of T4's six `unavailable` causes is in the DB test.** presby_app cannot change `organizations.status`. test-rls-71 captures the other causes, plus a null slug and a toggle-off posting read, all byte-identical (7 rows).
8. T6 (`src/lib/careers/public.db.test.ts`, the differential toggle test) is **Batch 2's**. It compares the definer against `orgFeatureEnabledInTx` and the catalog entry, which Batch 2 adds.

### Tests and failing-first proofs

- `scripts/careers/test-rls-71.sql` as presby_app: **84/84**, exit 0. Failing-first, each mutation applied as the owner, the suite re-run, and the first failure cited:
  - FORCE removed: 71a FORCE.
  - Policy dropped: 71a `tenant_isolation`.
  - Update guard or insert guard disabled: 71a "three guards ENABLED" (3 → 2).
  - Update guard body made permissive: 71d "slug changes … bumps version".
  - Insert guard body made permissive: 71d "a new posting is a draft, version 1…".
  - DELETE granted: 71c "exactly one TABLE-level privilege".
  - UPDATE (version) granted: 71c "UPDATEs exactly the 13 editable columns".
  - Sweep EXECUTE to presby_app: 71f "executable by its OWNER ALONE".
  - Public definer EXECUTE to PUBLIC: 71e ACL.
  - Hiring-committee binding removed: 71b "exactly two keys".
  - Bundle function reverted to 0059: 71b "carries careers.manage, careers.applicants after domains.manage".
  - Closed posting leaks its description: 71e "CLOSED … slug and title only".
  - Category axis ignored: 71e "byte-identical for every cause" (1 → 2).
  - Posting read ignores the closing date: 71e "CLOSED to the public at read time".

  Each was restored by a whole-file re-apply, and the suite was green again.
- `src/lib/db/domain/careers.db.test.ts`: **20/20**. Failing-first:
  - Advisory lock removed: the race test fails, because both publishes succeed.
  - Delete guard made permissive: "DELETE is refused for the owner" fails.
  - Sweep using `current_date` instead of the organization's zone: the zone test fails.
- Integrated `scripts/test-rls.sql` (the patches applied, run as presby_app from a scratch copy without stop-on-error): 1324 passes, 84 of them section 71, including the template count of 7. Three failures predate careers and are **pre-existing development-lineage drift**:
  - line 217 "presbytery: sees only its own members" (3 vs 2): the untracked membership that the file's own comment documents.
  - line 516 "2fa policy: definer function sees the requirement": no organization on the branch has `require_two_factor = true`, though the seed sets it on Alder Creek.
  - line 7927 "exactly ONE org-owned role holds statistics.publish": the 2026-10-14 `demo_everything` roles.

  With `ON_ERROR_STOP` on, the run aborts at line 217 before reaching section 71, so the orchestrator's post-merge run on development will need the same treatment, or a decision on that drift.
- Bundle suites (serial, `.env.local`): `invitations.db.test.ts` (the SQL array equals the TypeScript array, in order, for every organization_type), `designation-parity.db.test.ts` (12/12 on the regenerated golden), `founding-administrator.test.ts`, `accept.db.test.ts` and `issue.db.test.ts`: **219/219**.

### Gates

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npm run check`: all eight pass. `check:secrets` passed after the annotation above.
- Plain `npm test`: 584 files passed, 81 skipped; 8841 tests passed, 2489 skipped.
- `npm run check:schema-parity` (with the domain export added locally, then reverted): 86 tables, 0 failing. It reports 85 tables without the export, so `job_postings` is compared.
- `npm run docs:erd`: no change. Post-L domain modules are unmapped in `dev-docs.ts` by existing convention.
- Production pre-deploy reserved-path query (Integration items): run read-only on the branch. Syntax is valid, with a positive control (it reads 4 + 14 bundle pages) and 0 rows.

### Implementer Notes

Strings added or changed:
- `drizzle/0071_presby_careers.sql:82` and `:84` (Copy R1).
- `:147` (Copy R2, "Hiring Committee").
- `src/app/(admin)/admin/organizations/[id]/founding-administrator-section.tsx:44-45` (Copy D1).

**For Batch 2 (api-developer).** The signatures are as in the API Contract, with these facts:
- presby_app may not name `id`, `version`, `status` or `sort_order` in an INSERT, or `version`, the stamps, `created_*` or `updated_at` in an UPDATE. Drizzle `.insert().values()` must leave them out, and no `$onUpdate` may be added.
- Trigger refusals are 23514, with the message prefixes `job_postings: a posting is created as a draft`, `job_postings: % -> % is not a legal status change`, `job_postings: the slug is fixed once a posting has been published`, `job_postings: cap - at most 100 published postings per organization` and `job_postings: the closing date % has passed`. The CHECK `job_postings_complete_when_live` is also 23514. A slug collision is 23505 on `job_postings_org_slug_key`. DELETE is 42501.
- `MAX_PUBLISHED_PER_ORG` must equal the `c_published_cap` literal in 5b. `PUBLIC_POSTINGS_CAP` must equal `c_cap` in 7b.
- The sweep returns `(kind, organization_id, posting_id, application_id)`, ordered by organization then posting.
- The seed gives Fernwood (`/site/fernwood`) one posting in every state and Marrowbone one same-slug open posting, for the browser walk.

**For the orchestrator (integration).**
- Apply the four `scripts/careers/*.integration.patch` files (`git apply`, all check clean against `dcbb94a`).
- Re-read the live `presby_founding_administrator_permission_keys()` body at merge, if another pipeline re-creates it.
- The three pre-existing test-rls failures above.

**Next:** api-developer (Batch 2).

## Phase 4 — Batch 2 (api-developer)

**Date:** 2026-10-25. **Commits:** `4fd8726` (merge of `origin/main` at 0.44.0, PR #56: clean, no conflicts), `755cc8b` (pure libs), `ecc5c67` (catalog, audit keys, `SiteUrls`, reserved path, ingest message, tile), `cd68a58` (public reader, staff lib, sweep and cron step, placement reader, actions, boundaries), `d69b6b2` (the shared S8 strings), and the commit that records this section. **Neon branch:** `pipeline-careers` (development and production untouched). Port 3580 was used for one real-request smoke and stopped by PID.

**Feasibility re-run after the merge.** The design's list holds, with this drift:
- **Main added migration 0067 (public events calendar) and the branch's Neon database did not have it.** `events.website_listed` was missing, so every main suite that reads events (and Batch 3's e2e) would fail against this branch for a reason that is not careers. I applied `drizzle/0067_presby_public_events_calendar.sql` to `pipeline-careers` as the owner (`-1`, one transaction, as its header says); `public-calendar.db.test.ts` is 14/14 afterwards. The orchestrator applies it on development at integration as usual.
- `audit.ts`, `site-urls.ts`, `org-features.ts` and `render-site-page.tsx` changed on main (the calendar's two event keys, `portalCalendar`, the `public_calendar` catalog entry, the `eventsCalendar` slot). They merged without conflict and the careers additions sit beside them. `presby_founding_administrator_permission_keys()` is untouched by 0067 (grep: 0 mentions).
- The cron test's "exactly one platform execute" assertion (`route.test.ts:129-134`) still holds because the sweep module is mocked there; its own transaction is covered in `sweep.test.ts` and `sweep.db.test.ts`.
- `[[...path]]/page.test.tsx` asserts the `staffDirectory` and `committeeDirectory` slot closures individually, not the whole slot-key set, so adding `careers` in Batch 3 needs a new closure test (T18) and no change to the existing ones.

### Files Created

`src/lib/careers/`, each with a test beside it:
- Pure: `text.ts`, `contract.ts`, `dates.ts`, `slug.ts`, `description.ts`, `toolbar.ts`, `input.ts`, `html-to-markdown.ts`, `placement.ts`, `messages.ts`.
- Server: `public.ts`, `placement-read.ts`, `postings.ts`, `sweep.ts`.
- Tests that are not beside one file: `boundaries.test.ts`, `postings.db.test.ts`, `public.db.test.ts`, `sweep.db.test.ts`.
- `src/app/(org)/o/[slug]/admin/careers/actions.ts` and `actions.test.ts`.

### Files Modified

- `src/lib/org-features.ts` (the `org_portal.careers` entry), `src/lib/audit.ts` (three keys), `src/lib/site-urls.ts` (`careers()`, `careersPosting()`), `src/lib/sites-reserved-paths.ts` (`RESERVED_SITE_DESCENDANTS`), `src/app/api/sites/ingest/route.ts` (Copy I1), `src/lib/org-portal/tiles.ts` and `src/components/org-portal/tile-icons.tsx` (the tile and `Briefcase`), `src/app/api/cron/maintenance/route.ts` (the sweep step).
- Tests updated for the additions: `org-feature-catalog.test.ts`, `audit.test.ts`, `site-urls.test.ts`, `sites-reserved-paths.test.ts`, `api/sites/ingest/route.test.ts` (real route, real Postgres), `org-portal/tiles.test.ts` (23 tiles), `org-portal/visible-tiles.test.ts` (**not in the design's blast-radius list**: its two toggle-read lists gain `org_portal.careers`), `api/cron/maintenance/route.test.ts`.
- `docs/work-log/2026-10-25-careers-inc1.md:856`: Batch 1's note quoted the analyst's short-address payload literally, so `check:secrets` flagged the committed work-log; reworded (no address in the text).

### Schema Changes

None. (Applied 0067 to the Neon branch only, above.)

### Audit Events

- `CAREERS_POSTING_PUBLISHED`, `CAREERS_POSTING_CLOSED`, `CAREERS_POSTING_REOPENED` (`careers.posting.*`), written with `insertAuditRow(tx, ...)` in the **same transaction** as the change: from `postings.ts` (`via: "staff"`, actor the staff member) and from `sweep.ts` (`via: "closing_date"`, actor null). Metadata is `{ organizationId, postingId, via }` and nothing else; `resource_type` `job_posting`, `resource_id` the posting id. None for create, edit, reorder or discarding a draft. A failed audit insert fails the change (proved both ways in `postings.db.test.ts`; for the sweep in `sweep.db.test.ts`).
- `check:audit` has nothing to flag in `actions.ts` (it holds no `db.*` call); the three actions that write no row carry `// audit-exempt:` comments and `boundaries.test.ts` pins that the one status writer in the lib is followed by `insertAuditRow`.

### Deviations from the design (each restated, and checked against the intent)

1. **The INSERT is raw `sql`, not `db.insert(jobPostings).values(...)`.** Batch 1's note said Drizzle must leave the trigger-owned columns out of `.values()`; it cannot. Drizzle emits every column of the table with `default` for the omitted ones, and Postgres checks a column privilege against the statement's target list, so `presby_app` is refused (`permission denied for table job_postings`, reproduced as `presby_app` on the branch). `createPosting` uses a column-limited `insert ... returning id` in a `sql` template; `.update(...).set(...)` is fine because Drizzle sets only the keys given. `boundaries.test.ts` bans `.insert(jobPostings)`, bans naming a trigger-owned column in any `.set({...})`, and checks the raw column list.
2. **`closing_date_passed` carries `reopening: boolean`.** The design's result is a bare kind, but Copy S8 has two different sentences (publish versus reopen) and the action cannot tell which edge ran. Additive.
3. **Reopening a closed posting that was never published (a discarded draft) is allowed, and is audited as `PUBLISHED`, not `REOPENED`.** The design lists `closed -> published` as an edge and the trigger allows it; nothing said what to do with a discarded draft. It is a first publication, so it takes the same completeness checks and the PUBLISHED audit row. Batch 3: the Reopen dialog's body ("It returns to your website right away") is slightly off for a "Never published" row; decide whether to show Reopen there at all.
4. **The description validator's error codes are `heading_single`, `heading_level`, `link_scheme`, `link_unfinished`, `too_long`, `empty`.** The design names one `heading_level` but Copy S6 has two distinct messages, so the single-`#` case is its own code. The `empty` message, "Add a description before publishing.", is the S8 "Add a {fields} before publishing" template with one field; it is not a verbatim Copy line, flagged here for the orchestrator.
5. **The validator keeps leading spaces on the first line of the stored value** (only leading blank lines and trailing whitespace are trimmed). Trimming `"  # x"` would turn text the renderer reads as a paragraph into a heading after validation, breaking idempotence. Pinned in `description.test.ts`.
6. **The link scan is looser than the renderer's pattern on purpose:** any `[label](...)` is checked, including an empty or whitespace-containing address, which the renderer would leave as plain text. The cost is that prose like `[note](see below)` is refused as an unusable link. The design (T8) asks for whitespace-in-URL to fail with the right code.
7. **Only Copy leaves the building.** zod's own messages ("Invalid input: expected object, received null") would otherwise reach a person for a request that bypassed the form; `firstIssue()` passes a message through only if it is a Copy S6 field error and otherwise says the generic S8 line. New file `messages.ts` holds the S8 strings, shared with the client because a `"use server"` file can export only async functions (see the contract: the form recognises a stale save by comparing the action's `error` with `STALE_MESSAGE`).
8. **No session, an unresolvable slug and an ended membership all return the S8 "forbidden" line.** The Copy set has no "sign in" string and `/o/*` is already behind the proxy.
9. **Closing-date rule on update (design wording ambiguous):** a published posting's save is refused with "The closing date can't be in the past." only when the save **changes** the date to a passed one. A posting whose stored date has already passed (awaiting the sweep) can still have other fields saved with the date untouched. Drafts and closed postings may carry any date; publishing and reopening refuse it.
10. **A published posting cannot be saved with an empty summary, location or description:** the lib returns `incomplete` naming them (the design is silent; the database CHECK would have raised an unmapped 23514).
11. **`describePlacement` returns data (five states, including `unknown`), not strings.** The Copy S5 sentences need the site's URLs, so the page composes them.
12. **`sweepClosedPostings(tx)` is exported beside `runCareersSweep()`** as the test seam: the sweep is cross-organization, so a committed test run would close every other due posting on the branch.
13. **A posting key over 200 characters is `not_found` without a query** in `readPublicPosting` (it cannot be a slug); shorter malformed keys still go to the definer so the read count does not depend on shape.
14. **Attribution trailer.** The commits carry `Co-Authored-By: Claude Sonnet 5.5` (the harness's attribution for this session), not the `Opus 5.5` line Batch 1 used. Mechanically irrelevant to the hooks; mentioned so the pipeline's history is not read as an error.

### Tests and failing-first proofs

- **Unit tests (no database): 373 across these files** (the cron route's file holds 11, 4 of them new; counts per file: text 10, contract 12, dates 8, slug 11, description 50, toolbar 28, input 56, html-to-markdown 40, placement 16, placement-read 4, public 66, sweep 9, messages 3, boundaries 21, actions 28, cron route 11), plus the updated existing files.
- **DB-backed (real Postgres, serial, as `presby_app` through `withOrgContext` or the anonymous `db`):** `postings.db.test.ts` 47 (T15), `public.db.test.ts` 6 (T6 over all 27 combinations plus the driver's real jsonb and date shapes), `sweep.db.test.ts` 3 (T23, run inside a rolled-back transaction), the ingest route's careers cases (4 refused with the exact I1 message, 2 bare-`/careers` accepted).
- **Failing-first:** `postings.db.test.ts` was written before `postings.ts` and run red (module missing); then green on the first full run. I mutation-checked the gate (made the toggle check a no-op): the two toggle-off tests failed. The sweep's audit rollback test commits the due posting first, so the assertion that it is still `published` after a failed audit insert is about the sweep's transaction and not a vanished fixture. Each pure file's tests were written with it; the description validator's renderer-agreement tests render every accepted href through the real `<Prose>`.
- **Real-request smoke:** `next dev -p 3580`, a throwaway congregation with a due posting, `GET /api/cron/maintenance` with the bearer: 200, `careersPostingsClosed: 1`, the posting `closed`, one audit row (`careers.posting.closed`, actor null, metadata `{organizationId, postingId, via: "closing_date"}`, user agent `vercel-cron/1.0`, ip null), an unauthenticated call 401. The server was stopped by PID and the port confirmed free.
- **Held-out checks:** `scripts/careers/test-rls-71.sql` as `presby_app`: 84 pass, none fail, unchanged.

### Gates

- `npm run typecheck`: pass. `npm run lint`: pass (0 warnings). `npm run check`: all eight pass.
- Plain `npm test` (no database variables, as CI): 606 files passed, 85 skipped; 9364 tests passed, 2597 skipped (Batch 1: 584/81 and 8841/2489).
- Serial DB run of every file this batch touches, plus the bundle suites: 42 files, 824 tests, all pass (`src/lib/careers`, `src/lib/db/domain/careers.db.test.ts`, the ingest route, the cron route, `org-features.test.ts`, `src/lib/onboarding`, `src/lib/invitations`). `public-calendar.db.test.ts` 14/14 after applying 0067.
- `npm run build` was not run (nothing in this batch adds a route or changes a page; the dev server compiled the cron route and its imports).
- No e2e is assigned to Batch 2 by the design (T25-T27 are Batch 3's).

### Implementer Notes

Strings added or changed (all from Copy):
- `src/lib/careers/description.ts:135,142,158,159,172` (S6 description errors; `:180` is the flagged `empty` message, deviation 4).
- `src/lib/careers/input.ts:102,129,142,146,152` (S6 field errors); `src/lib/careers/messages.ts` (S8 errors, whole file); `src/lib/careers/postings.ts:120-121` (the slug-fixed sentence from S6 and the passed-date sentence from S6).
- `src/lib/careers/contract.ts` `formatPay` and `employmentTypeLabel` (P9, P4).
- `src/lib/org-features.ts:160,162` (F1, F2); `src/lib/org-portal/tiles.ts:315-316` (T1); `src/app/api/sites/ingest/route.ts:120` (I1).

**The contract Batch 3 consumes** (exact signatures are in the files; this is the map):

*Staff lib, `@/lib/careers/postings`* (all `import "server-only"`; call from `(org)` pages, never from `(admin)`):
`listPostings(viewerPersonId, organizationId)`, `getPosting(viewerPersonId, organizationId, postingId)`, and the four writers called through the actions. Results are `CareersResult<T>`: `ok | feature_off{canManageFeatures} | forbidden | not_found | stale | slug_taken | invalid_input{field,message} | incomplete{missing[]} | closing_date_passed{reopening} | publish_limit | invalid_transition`. `PostingRow` is as designed; the page derives: "Never published" = `status === "closed" && firstPublishedAt === null`; "Closing date passed" = `status === "published" && !visibleToPublic`; stale hint = `isStale(postedOn, closingDate, orgToday)` (`dates.ts`, status published); the slug field is read-only when `firstPublishedAt !== null`; the Reopen note uses `closingDatePassed(closingDate, orgToday)`. Rows come back grouped published (display order), then drafts (newest edit first), then closed (most recently closed first). `getPosting` and `listPostings` return `orgToday`.

*Server actions, `admin/careers/actions.ts`* (all `ActionResult`, organization from the slug and the session, never the input):
`createPostingAction(slug, PostingInput) -> {id}`, `updatePostingAction(slug, PostingUpdateInput) -> {version}`, `setPostingStatusAction(slug, {id, version, to}) -> {status, version}`, `movePostingAction(slug, {id, direction}) -> {moved}`. `PostingInput`/`PostingUpdateInput` are in `@/lib/careers/input` (`descriptionMd` is the raw text; `slug` optional; `payMinCents`/`payMaxCents` in cents; `closingDate` `YYYY-MM-DD` or null; `employmentType` `full_time|part_time|intern`; `payUnit` `hour|year`). The toast must report the **returned** `status`. **The form recognises a stale save by `result.error === STALE_MESSAGE`** (import from `@/lib/careers/messages`, which also exports the other S8 strings): show the Reload button and keep the typed text. Every `error` string is Copy.

*Pure helpers the editor and form use:* `validateDescription(raw, {requireNonEmpty}) -> {ok, value} | {ok:false, errors[{line, snippet, code, message}]}` (run it live; it is the same function the server runs), `applyToolbar({value,start,end}, action) -> {value,start,end}`, `htmlToMarkdown(html, parse?) -> {markdown, droppedLinks} | null` (null: let the browser paste plain text; it needs a `DOMParser`), `parseDollarsToCents(text) -> number | null`, `slugFromTitle`, `isValidSlug`, `charCount` (code points; use for "{n} of 20,000 characters"), `formatPay`, `employmentTypeLabel`, `isStale`, `closingDatePassed`, and the constants in `contract.ts` (`DESCRIPTION_MAX`, `SUMMARY_MAX`, `TITLE_MAX`, `LOCATION_MAX`, `SLUG_MAX`, `PAY_CENTS_MAX`, `CAREERS_SLOT`). `posting-schema.ts` (the string-valued form schema) and its golden test are Batch 3's.

*Public reads, `@/lib/careers/public`:* `readPublicCareers(slug) -> PublicCareers` and `readPublicPosting(slug, posting) -> PublicPostingRead`; pass the **database-returned** slug (`resolveSiteOrganization(...).slug`), never the request key. States: `unavailable` (404 on the pages, the notice in the slot), `failed` (the noindex notice on the pages, the same notice in the slot), `available | open | closed | not_found`. A mapped posting has no id; hrefs come from `SiteUrls.careers()` / `careersPosting(slug)`.

*Placement, `@/lib/careers/placement` and `placement-read`:* `readPlacement(orgSlug) -> PlacementInput` (`known{pages}` or `unknown`), `describePlacement(input) -> slot_and_list | slot_only | list_only | own_page_no_slot | unknown` (the page writes the S5 sentences with the `/careers` address from `SiteUrls`), `careersBackTarget(input, urls)` for the posting page's "All job openings" link.

*Wiring Batch 3 still owes* (design step 8): the `careers` entry in `render-site-page.tsx`'s `liveSlots` closing over the database slug and `urls` only, the public routes, `PublicCareersSlot`, the staff pages, `disabled`-until-hydrated controls, and the e2e/hydration specs. The seed fixture note: Batch 1's own sweep tests already closed the seed's past-due posting (`office-assistant` is `closed` on this branch), so any spec that needs a derived-closed row should create its own and set the date by owner SQL (publish with no date or today, then update `closing_date`), as `postings.db.test.ts` does.

**Open for the orchestrator.** No integration patch is needed for this batch (no Rule 16 file was edited; `scripts/careers/*.integration.patch` are Batch 1's). Apply 0067 to development as the calendar pipeline's own integration step requires. The cron's careers audit rows carry the cron request's user agent (`vercel-cron/1.0`) because `insertAuditRow` reads request headers; no ip, actor null.

**Next:** ux-developer (Batch 3).

## Phase 4 - Batch 3 (ux-developer)

**Date:** 2026-10-25. **Commits:** `2da6bdf` (public pages, slot, shared components), `adeeb19` (staff pages, editor, status controls), `5ab2e0d` (e2e and hydration specs, fixture), and the commit that records this section (it also carries a one-line wrap fix, below). **Neon branch:** `pipeline-careers`. Dev server on :3580 and prod lane on :3581, both stopped by PID; :3000 never touched. Orchestrator rulings applied: no Reopen on "Never published" rows; "Add a description before publishing." accepted as Copy.

### Files Created
- `src/components/careers/`: `posting-description.tsx` (site-kit `<Prose>` in a wrapper with its own typography, no `.presby-site`), `posting-meta.tsx`, `careers-list.tsx`, `careers-notice.tsx`, each with a test.
- Public: `(public)/site/[slug]/careers-slot.tsx`, `careers/page.tsx`, `careers/[posting]/page.tsx`, `careers/posting-view.tsx`, with tests.
- Staff, `(org)/o/[slug]/admin/careers/`: `page.tsx`, `new/page.tsx`, `[postingId]/page.tsx`, `careers-access.tsx` (the repeated `(org)` auth ladder in one place), `careers-states.tsx`, `postings-list.tsx`, `placement-line.tsx`, `posting-form.tsx`, `posting-schema.ts` (+ golden test), `description-editor.tsx`, `description-preview.tsx`, `status-controls.tsx`, `move-buttons.tsx`, with tests.
- e2e: `e2e/careers.spec.ts` (20), `e2e/custom-domains/careers.spec.ts` (9), `e2e/hydration/careers-posting-form.spec.ts` (3), `e2e/support/careers-fixture.ts` (NEW file; no existing support file edited).

### Files Modified
- `render-site-page.tsx`: the `careers` liveSlot entry beside `eventsCalendar` (closes over the database slug and `urls` only).
- Tests: `[[...path]]/page.test.tsx` (slot-key set now includes `careers`, plus a closure test: author filter ignored, props are exactly `slug` and `urls`), `give/fall-through.test.tsx` (mocks the careers reader, as it does the calendar's).

### Schema Changes / Audit Events
None. Batch 3 writes no audit rows itself; the e2e asserts the lib's rows (publish, close, reopen present with ids and an enum only; none for discard).

### Deviations (each restated)
1. **Fixture location.** `e2e/support/careers-fixture.ts` is a new file under `e2e/support/` (the design lists it there). No existing file in that directory changed. If the orchestrator reads Rule 16's `e2e/support/*` as "no new files either", move it; nothing else depends on its location but the three specs' imports.
2. **Editor toolbar has no `role="toolbar"`/aria-label.** A label would be a string outside Copy, and labelling it by "Description" made two controls share a name. It is a plain group of seven labelled buttons.
3. **Pay-unit select has no label text of its own** (Copy gives none): it is named by the "Pay (optional)" legend through `aria-labelledby`, defaults to "per hour", and the unit is sent only when an amount is.
4. **Publish and Reopen save unsaved edits first** (`prepare` in `posting-form.tsx`), then change status on the returned version; a failed save publishes nothing. Not in the design; it prevents publishing the saved text while the screen shows newer text. Close and Discard never save.
5. **Reopen is disabled (not just noted)** when the closing date has passed; the Copy note sits beside it.
6. **Placement line with several slot pages** lists them ("/a, /b and /c pages"); Copy shows one `{path}`.
7. **Public pages with an unknown organization name** (a `failed` read) show the h1 "Job openings" and the P1 notice, with no back link, because the name is unknown.
8. **Titles are limited to 150 characters** by the database, so the "200-character unbroken title" fixtures are 150 (the maximum).
9. **"Direct action call is refused" (T25)** is proven as: a tampered read-only field is ignored by the form, and the owner connection cannot change a published slug (the trigger). A raw Server Action POST is not driven (no stable action id from outside); the lib's refusal is `postings.db.test.ts`'s.
10. **No Staff-side `loading.tsx`** anywhere in the new routes (they redirect or 404).

### Tests and gates
- New unit tests: 134 across 18 files (components 12 + notices; slot 5; posting-view 5; public pages 17; staff: states 4, placement 7, list 10, move 5, status 10, editor 13, form 15, pages 17, schema golden 11; plus the two touched existing files). Plain `npm test`: 622 files passed, 85 skipped; 9505 tests passed, 2597 skipped (Batch 2: 606/9364).
- `npm run typecheck`, `npm run lint` (0 warnings), `npm run check` (all eight), `npm run build`: pass. `boundaries.test.ts` (T24) green with the UI present; it caught a `confirm(` function name in `status-controls.tsx`, renamed.
- e2e on :3580 (RATE_LIMIT_DISABLED, DOMAINS_* fakes, CRON_SECRET, STRIPE_WEBHOOK_SECRET, E2E_ALLOW_SHARED_DB): `chromium` project `careers.spec.ts` 20/20 and the hydration spec 3/3; `custom-hosts` project `careers.spec.ts` 9/9 plus `lockdown.spec.ts` 30/30. Prod lane on :3581 (`PW_PROD_BUILD=1 PW_PROD_PORT=3581`, own `next build` and `next start`): hydration spec 3/3.
- Negative controls: with `<HydrationGate>` removed from `posting-form.tsx` the hydration spec's new-form and edit-form tests go red; with `!hydrated ||` removed from the move buttons its list test goes red. Both restored (diff clean). A first e2e run caught a test-side mistake (`Control+a` is "line start" on macOS; now `ControlOrMeta+a`), not a product defect.
- Editor route client chunk: the one chunk carrying the editor, the preview and all of site-kit is 56,171 bytes raw / 17,717 bytes gzip (production build, minified). `<Prose>` bundles for the client; the design's server-preview fallback was not needed.

### Browser walk (real Chromium, dev server, both hosts)
A throwaway congregation (removed afterwards) with four published postings (one with a 150-character unbroken title, one past its closing date), a draft, a closed and a discarded posting, a site whose bundle carries the slot on `/employment`, a profile phone and a live custom host `walk-careers.invalid`. Screenshots at 360x800 (touch, mobile) and 1280x900 of: public list, open posting, closed posting, slot page, 150-character-title posting (platform host); list, posting, slot page (custom host); staff list (Closed section opened), new, edit for a published, draft, closed and discarded posting; plus the staff forbidden and feature-off states at 360px. Read by eye: platform list, open posting, closed posting, slot-in-chrome, staff list and published-edit at 360px, and the open posting at 1280px; the rest were captured with the same assertions the specs make (no horizontal scroll, 44px targets) and were not each opened. Findings: none blocking. One cosmetic fix made: the profile phone broke across lines at a hyphen in "How to apply", so it is now `whitespace-nowrap`. The Next dev overlay button appears in the screenshots and is not part of the app.

### Implementer Notes
Strings added, all from Copy: P1-P9 in `careers-notice.tsx`, `careers-list.tsx`, `posting-meta.tsx`, `posting-view.tsx`, `careers/page.tsx`; S1-S4 in `careers-states.tsx`; S5 in `placement-line.tsx`; S6 in `posting-form.tsx`, `description-editor.tsx`, `description-preview.tsx` and the Reopen note in `status-controls.tsx`; S7 in `postings-list.tsx`; S8 dialogs and toasts in `status-controls.tsx`, `posting-form.tsx`, `move-buttons.tsx`. Not in Copy and flagged: the no-name `failed` page shows P3's "Job openings" as its only heading (deviation 7); the section `aria-label="Job openings"` on the slot (P3's words); the toolbar group has no accessible name (deviation 2); the "Reload" button on the stale message is S8's.

**Integration text for the orchestrator:** none new. Batch 3 edits no Rule 16 file, so there is no new `scripts/careers/*.integration.patch`. The four from Batch 1 stand. At ship (tech-lead): the CLAUDE.md Project Layout lines already cover `src/components/careers/`.

**Next:** qa (Phase 5).

---

# Phase 5 — Verification (qa)

*Pending.*

---

# Phase 6 — Shipped vs Intent (analyst)

*Pending.* Must walk (Phase 1 and the parent's list, scoped to this increment): an anonymous visitor at 360px on a platform host and on a custom host; a `careers.manage` holder; the founding administrator who accepted an invitation, adopted "Hiring Committee" and turned the toggle on, at 360px, listing each page they land on; a member with no permission; an organization with the toggle off.

---

# Phase 5 — Verification (qa)

**Date:** 2026-10-26
**Verified by:** qa
**Tree:** `pipeline/careers` at `27a997e`, worktree `/Users/cshenso/git/presby-platform/presby-careers`, Neon branch `pipeline-careers` (all five connection strings confirmed on `ep-crimson-tooth`; no value printed).

**Scope run:** everything the brief asked for, in full. Typecheck, lint, all eight tripwires, build, the full unit suite, the full serial DB suite, `test-rls-71` and the integrated `test-rls.sql` as `presby_app`, the full `chromium` and `custom-hosts` projects on my own dev server at :3580, and the prod lane on :3581. Nothing rests on the implementer's runs.

**Flag state:** I reset global flags to the CI baseline before e2e with `scripts/ci/e2e-reset-flags.sql -v pipeline_branch=1`, run against this worktree's `PLATFORM_DATABASE_URL` only. The branch had 25 flags switched on that it inherited from `development`. After all runs, the flags still equal the baseline.

## Type Check

`npm run typecheck`: PASS. `npm run lint`: PASS (0 warnings). `npm run check`: all eight tripwires PASS. `npm run build` (inside the prod lane): PASS. TypeScript ran, and all five careers routes were emitted as dynamic (`ƒ`).

## Unit Tests

- **Plain `npm test`** (no database): 622 files passed, 85 skipped; 9,505 tests passed, 2,597 skipped. This matches Batch 3 exactly. The skips are the DB-gated files.
- **Full serial DB suite:** 707/707 files; 12,101 passed, 0 failed, 1 skipped (`render-pdf.test.ts`'s opt-in sample writer, gated on `STATEMENT_SAMPLE_DIR`); 2,001 s.
  - No `localhost:3000` failures, because `.env.local` sets no port.
  - My first DB run is void. The presby-assets QA agent writes to the same shared-scratchpad log path, and its output landed in my log. I re-ran with a unique path and a JSON report; the counts above are from that re-run.
- **`scripts/careers/test-rls-71.sql`** as `presby_app`: 84/84, exit 0. It also gave 84/84 again after every failing-first restore.
- **Integrated `scripts/test-rls.sql`** as `presby_app` (scratch copy, stop-on-error off): 1,357 passes, 84 of them section 71, including the template count of 7.
  - **Known drift, as expected:** lines 217, 516 and 7927.
  - **Also failing, not careers:** 7 assertions in section 67 (public calendar, from main), starting with "Fernwood's `org_portal.public_calendar` toggle is on — got 0". The cause is branch state. Batch 2 applied 0067's migration to this branch but never its seed (`scripts/public-calendar/seed-dev-public-calendar.sql`). A read-only check shows Fernwood has only `org_portal.calendar` and `org_portal.careers` toggles.
  - **No collision between the two seeds:** both insert Fernwood's site as `live` with no bundle, using `on conflict (organization_id) do nothing`, and the careers seed touches no calendar toggle.

## End-to-End Tests

| Lane | Result | Careers specs |
|---|---|---|
| `chromium`, full, dev server :3580 | 463/463 passed, 0 skipped, 0 flaky (15.9 min) | `careers.spec.ts` 20/20, `hydration/careers-posting-form.spec.ts` 3/3 |
| `custom-hosts`, full, :3580 | 120/120 (3.7 min) | `custom-domains/careers.spec.ts` 9/9 |
| prod lane (`prod-build` + `prod-custom-hosts`), own build on :3581 | 82/82 (2.3 min) | careers hydration 3/3 |

The first `chromium` attempt is void. My first dev server got stuck in a Turbopack HMR loop (HMR version over 1,670, `reloadPage: HMR hash mismatch` on every connect), and every test timed out on the hydration-gated sign-in button. I stopped that run and the server by PID, confirmed no file in the worktree had changed, restarted the server, and checked that the loop was gone before the 463/463 run. Both servers were stopped by PID, :3000 was never touched, and no `e2e-careers-*` organization remains.

## Regression Tests Added (failing-first, reproduced independently)

Each SQL mutation was built from the live function body, applied as the owner, and then the original body was restored. The digest of all seven careers functions, their ACLs and `proconfig`, the triggers and FORCE RLS matched the baseline after every restore. The TypeScript mutations ran in a `git archive` copy at `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/qa-careers-ff-27a997e` against the real database; that copy, including its `.env.local`, is now deleted. No `git stash` was used.

| Mechanism | Mutation | Went red | Green after restore |
|---|---|---|---|
| Always-one-row collapse (SQL) | toggle-off branch returns zero rows | 71e "seven unavailable causes captured — expected 7, got 3"; `public.db.test.ts` 2 failed | yes |
| Always-one-row collapse (reader) | `mapPublicCareersRow(undefined)` returns `unavailable` | `public.test.ts` "an absent row is FAILED, never an empty list" and "fails closed" | 66/66 |
| Toggle gate (definer) | `v_on := v_cat_ok` | 71e "byte-identical for every cause — got 3"; T6 "agrees across all 27 combinations" | yes |
| Toggle gate (staff lib) | `if (false && !on)` | `postings.db.test.ts` "toggle off: every call is feature_off…" and "toggle row explicitly false…" | 47/47 |
| Auto-close sweep | `closing_date <= today` (off by one) | `careers.db.test.ts` "closes only published postings past their closing date in the ORGANIZATION's zone…" (71 cannot see the sweep; `presby_app` has no EXECUTE) | yes |
| Sweep audit | `insertAuditRow` removed from `sweep.ts` | `sweep.db.test.ts` 3/3 failed | 3/3 |
| Slug immutability trigger | slug check removed from the guard | 71d "a published posting's slug changed"; `careers.db.test.ts` "the slug is fixed after the first publish for the owner too, including after a reopen" (`postings.db.test.ts` stays green because the lib checks too) | yes |
| Founding-administrator bundle (SQL) | both keys dropped from the function | 71b; `invitations.db.test.ts` "equals foundingAdministratorPlan() for EVERY organization_type"; designation parity 7 scenarios | yes |
| Founding-administrator bundle (TypeScript) | both keys dropped from the plan | `founding-administrator.test.ts`, 8+ tests | 144/144 |

**Gap noted:** the pure plan tests in `founding-administrator.test.ts` sit inside the file's DB-gated `describe.skipIf(!hasDb)`. Plain CI unit runs therefore never exercise them; only the DB lane does.

## Coverage on Critical Modules

Not re-measured. This diff does not touch `permissions.ts`, `two-factor.ts` or `flags.ts`.

## Feature-Gate Audit

Verified by reading the code. The careers surface uses the tenant resolver rather than `hasFeature()` and `FEATURES.*`: `careers.manage` is a tenant-catalog key checked through `presby_has_permission`, which is correct for `(org)`.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct key? |
|---|---|---|---|
| `createPostingAction` | yes (`actions.ts:77`), then `resolveOrgContext` | n/a (tenant axis) | gate in `postings.ts:149-166`: toggle, then `careers.manage` inside `withOrgContext` |
| `updatePostingAction` | yes, same | n/a | same gate |
| `setPostingStatusAction` | yes, same | n/a | same gate; audit in the same transaction (`postings.ts:529-537`) |
| `movePostingAction` | yes, same | n/a | same gate |
| GET `/o/[slug]/admin/careers`, `/new` | `cachedAuth()` in `careers-access.tsx:22`, then the `(org)` four-way miss, then `assertOrgAccess` | n/a | gate via `listPostings` |
| GET `/o/[slug]/admin/careers/[postingId]` | yes, same | n/a | gate via `getPosting`, **except for a malformed id** (finding 3) |
| GET `/site/[slug]/careers`, `/careers/[posting]`, the `careers` slot | anonymous by design | n/a | one definer that always returns one row; `unavailable` is the one neutral 404 |
| GET `/api/cron/maintenance` (modified) | bearer `CRON_SECRET`, unchanged | n/a | the sweep is EXECUTE-revoked from `presby_app`, `presby_platform` and PUBLIC; owner only |

`getPlatformDb()` under careers appears only in `sweep.ts:70`. No new `/api` route and no `src/proxy.ts` change.

**Schema/RLS live-catalog probe** (`aclexplode`, `pg_policies`, `pg_trigger`, `relforcerowsecurity`):
- `job_postings` has FORCE RLS and `tenant_isolation` on both USING and WITH CHECK.
- `presby_app` has table SELECT, a 13-column INSERT and a 13-column UPDATE, exactly as designed, and no DELETE. `presby_platform` and PUBLIC have nothing.
- The three guards are enabled `O`, and all seven functions pin `search_path`.
- Catalog: `careers.manage` is tier 1, `careers.applicants` is tier 3, and neither requires 2FA. `hiring_committee` is a universal `custom` template with exactly the two keys; no other template carries `careers.applicants`.

Which layer refuses each write:

| Attempt | Connection | Refused by |
|---|---|---|
| DELETE | `presby_app` | grant (42501) |
| UPDATE `version` | `presby_app` | grant (42501) |
| INSERT with `status` | `presby_app` | grant (42501) |
| slug change after publish | `presby_app` | trigger (23514, `job_postings: the slug is fixed`) |
| published → draft | `presby_app` | trigger (23514) |
| cross-org INSERT | `presby_app` | RLS WITH CHECK |
| run the sweep | `presby_app` | EXECUTE revoked (42501) |
| INSERT born `published` | owner | trigger |
| slug change after publish, and after a reopen | owner | trigger |
| DELETE | owner | trigger (42501) |

On the owner connection, a supplied `version` and `first_published_at` are forced back to 1 and null. Read isolation holds: another org's context sees 0 rows, and no context sees 0 rows. The definer returns exactly one row for a known, an unknown and a malformed key.

## Copy Truthfulness

- [x] Every added or changed string is in the design's Copy table. Accepted derivations: the no-phone variant of P5, the plural placement line (deviation 6), the `failed` page's bare "Job openings" (deviation 7), the h1 "New job opening" (it reuses the S7 button text), and "Reload" (S8).
- [x] The query behind each claim was opened. P2 needs a successful `available` read. P6 comes from the definer's `closed`. "Closing date passed" is `closing_date < orgToday` read in the same transaction. The placement line reads the published bundle only and says when it cannot check.
- [x] Each instruction is traced to its viewer's role. S1's Features link renders only when the same transaction found `org_features.manage`, and the walk showed both variants. S2's instruction is followable by any member.
- [x] Neighbouring strings: I grepped and found nothing that this diff makes false.
- **copy truthfulness: FAIL.**
  - **Where:** `src/app/(org)/o/[slug]/admin/careers/posting-form.tsx:371` passes the stored `posting.title` to `StatusControls`, which builds `Publish "{title}"?` and `Reopen "{title}"?` (`status-controls.tsx:59,77`). Since deviation 4 (save-first), Publish and Reopen save the form's unsaved edits before changing status.
  - **Who sees it:** a `careers.manage` holder.
  - **Reproduced in the browser at 1280px:** I renamed a draft to "Renamed Before Publish" without saving and clicked Publish. The dialog read `Publish "Draft Opening"?`; after "Yes, publish" the row in the database was `{"title":"Renamed Before Publish","status":"published"}`.
  - The dialog names a title that will not be the one published. The fix needs an exact-text test that fails on the stored title.

## Browser walk

Real Chromium against :3580, at 360×800 (mobile, touch) and 1280×900, on a throwaway fixture with eight postings covering every state, plus a profile phone, a bundle with the slot on `/employment`, and a live custom host `qa-walk-careers.invalid`. 56 screenshots in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/qa-careers-71/walk/`; the custom-host pass re-ran into `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/qa-careers-71/walk2/`. I read the 360px public and staff screenshots and the publish dialog by eye.

**Public, platform host**
- List, rich posting, 150-character-title posting, closed posting and the slot inside the site chrome all render with no horizontal scroll at either width.
- With the toggle off, `/careers` and a posting URL are 404, and **the slot page shows P1**. This is the capture the implementer left out, now done at 360px and 1280px.

**Public, custom host**
- The list, the posting and the slot page all name the church's host in their canonical URLs.
- The slug URL answers 307 with `no-store` to the host.
- A draft, a discarded draft, an unknown slug, `UPPER` and `walk-rich-x` are all the neutral 404, and no cookie is ever set.
- With the toggle off, the slot shows P1 and `/careers` is a 404.

**Staff**
- List (Closed `<details>` opened, the "Closing date passed" row, move buttons on published rows only), new, and edit for published, past-date, draft, closed, closed-with-past-date and discarded postings.
- Reopen is disabled with the S6 note, and a discarded draft offers no Reopen (orchestrator ruling).
- Not found, S2, S1 with and without the Features link.

**Not walked**
- The `failed` read state; I could not induce a database failure safely (it is unit-tested).
- Real iPhone or Android keyboards, and a real Word or Google Docs clipboard (the design marks these not automatable).

## Batch 3 deviations judged

1. **Fixture file location.** Accepted. The `e2e96000` and `e2e96001` id prefixes appear in no other worktree, and no existing support file changed.
2. **Toolbar has no `role="toolbar"` or group name.** Accepted. Seven buttons, each with a visible text name, is not an accessibility failure.
3. **Pay-unit select named by the legend.** Accepted. `aria-labelledby="posting-pay-legend"` is at `posting-form.tsx:263`.
4. **Save-first on Publish and Reopen.** The behaviour is sound, but it introduced the copy defect above, and it does not cover finding 2.
5. **Reopen disabled, not just noted.** Accepted; verified in the browser.
6. **Several slot pages listed.** Accepted.
7. **`failed` page without the organization's name.** Accepted; the name is unknown there.
8. **150-character titles in the fixtures.** Accepted; that is the database limit.
9. **No raw Server Action POST.** Accepted. The lib's refusal and the trigger are both proven (M4 above).
10. **No `loading.tsx`.** Confirmed: none in either careers tree.

## Findings

1. **FAIL, copy truthfulness:** the stale dialog title described above (`posting-form.tsx:371`, shown by `status-controls.tsx:59,77`).
2. **FAIL, unsaved edits dropped (save-first is incomplete).** Close and Discard never save, then `router.refresh()` (`status-controls.tsx:146`) bumps the version, and the form is keyed on `id-version` (`[postingId]/page.tsx:79`). The form remounts and drops typed edits without the unsaved-changes prompt.
   - Walk: I typed "UNSAVED SUMMARY EDIT" and confirmed Close. The form then showed the stored summary, and the database summary was unchanged.
   - Either warn, or treat these two edges the same way as Publish and Reopen.
3. **Minor: gate skipped for a malformed posting id.** `[postingId]/page.tsx:38-41` returns `not_found` for a malformed id without running the gate, so a member with the toggle off and no permission sees S4 "That job opening couldn't be found." instead of S1. The walk captured this (`staff-off-malformed-id-*.png`). Nothing leaks, but the comment at `:38` ("the gate still runs on the list read below") is false: there is no list read.
4. **Integration patches are stale.** `scripts/careers/test-rls.sql.integration.patch`, `seed-dev.sql.integration.patch` and `_journal.json.integration.patch` fail `git apply --check` at HEAD; only `domain-index.ts` applies. The main merge `4fd8726` brought in 0067's integration commit `5fa2e29`, which appended to all three files, so Batch 3's statement "The four from Batch 1 stand" is no longer true. The conflicts are trivial appends; I applied them by hand in a scratch copy for the integrated run.
5. **For Phase 6 or tech-lead, not a Phase 4 defect:** open postings and the list are `noindex, nofollow` on both hosts, inherited from `src/app/layout.tsx:41` (`// pre-release; revisit before launch`). Bundle pages override this to `index, follow`. The design implies open postings are indexable but never pinned it.
6. **Branch state:** apply `scripts/public-calendar/seed-dev-public-calendar.sql` to `pipeline-careers` if section 67 is to pass on this branch.
7. **Process note:** I overlaid my first archive onto a leftover scratchpad directory `ff/` that belonged to an earlier agent (last modified 15:47). I removed my nested `node_modules` symlink and the `.env.local` I had written there, but that directory's tracked files are now this branch's.

## Verdict

**FAIL.** Every suite is green, and the mechanisms, gates and RLS posture all hold under failing-first and live-catalog probes. It fails on copy truthfulness (finding 1) and on the incomplete save-first behaviour (finding 2), both in Batch 3's deviation 4. This is not auth-touching. Finding 1 needs an exact-text test that fails on the stored title.

**Hand back to ux-developer (Phase 4):**
- `posting-form.tsx:371` and `status-controls.tsx:59,77`: use the form's live title in the Publish and Reopen dialogs, with an exact-text test that fails on the stored title (finding 1).
- `status-controls.tsx:146` and `[postingId]/page.tsx:79`: stop Close and Discard from silently dropping unsaved edits, with a test (finding 2).
- `[postingId]/page.tsx:38-41`: run the gate before the malformed-id `not_found`, or correct the comment (finding 3).
- Regenerate the three stale integration patches against HEAD (finding 4).

After the fix, a scoped re-run is enough: the staff unit tests, `careers.spec.ts`, the hydration spec on both lanes, and the 360px editor walk.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete; all suites green; failing-first reproduced for 9 mutations; findings 1–4 handed back | FAIL | 2026-10-26 |

**Next:** ux-developer (Phase 4 fix pass) for findings 1–3; the integration-patch regeneration (finding 4) goes to the implementer or the orchestrator. Then qa again.

Logs and artifacts are in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/qa-careers-71/`.

---

# Phase 4 — fix pass (QA run 1) (ux-developer)

**Date:** 2026-10-26. Branch `pipeline/careers`, from `9888dc6`. Findings 1-4 of QA run 1, each failing-first.

## Changes

1. **Finding 1 (copy truthfulness).** `posting-form.tsx` passes the form's live `title` (the `useWatch` value) to `StatusControls`, so `Publish "{title}"?`, `Reopen "{title}"?` and `Close "{title}"?` name the text that will be saved and published. Tests: `posting-form.test.tsx` "Publish names the title being typed" and "Reopen names the title being typed" (exact text, and the stored-title string must be absent).
2. **Finding 2 (unsaved edits dropped), orchestrator ruling.** Close now saves unsaved edits first, like Publish and Reopen, through the same `prepare`; a failed save changes nothing. Discard does not save (the edits go with the discarded draft). No new strings. In `status-controls.tsx` the condition is `change !== "discard"`. Tests: `posting-form.test.tsx` "Close saves unsaved edits first…", "Close with a failed save leaves the posting open", "Close with nothing unsaved goes straight to the loaded version", "Discard does not save"; `status-controls.test.tsx` updated (it had pinned the old "Close does not").
3. **Finding 3.** `[postingId]/page.tsx` calls `getPosting` for every id, so the gate (toggle, then permission) always runs. A malformed id is replaced by the nil GUID, which no row has, so the database never sees the raw text and the answer is `not_found`. The false comment is replaced. Tests in `page.test.tsx`: the malformed id never reaches `getPosting` as typed, and a malformed id gives S1 (toggle off) and S2 (forbidden), not not-found. The existing e2e "a malformed or unknown posting id is the not-found state" still passes.
4. **Finding 4.** `scripts/careers/{test-rls.sql,seed-dev.sql,_journal.json}.integration.patch` were regenerated by editing the real files, diffing, and restoring them (the shared files are not committed). Each of the four patches passes `git apply --check` at HEAD. The seed hunk's comment now says "person-emails and public-calendar includes".
5. **Found at 360px (new).** The dialog buttons in `status-controls.tsx` were 34.8px high (the shadcn AlertDialog default), under the 44px floor. `AlertDialogCancel` and `AlertDialogAction` now carry `min-h-11`. New e2e (`careers.spec.ts`, 360px describe): the Publish and Close dialogs name the typed title, sit inside the 360px viewport with no horizontal scroll, have 44px buttons, and Close persists a typed title.

## Red then green

- Before the fix, 5 failed: both live-title tests, both Close tests, and the malformed-id gate test.
- After the unit fixes, the old status-controls test failed on its own pinned "Close does not" and was rewritten. With the Close save-first condition reverted alone (`copy.to === "published"`), 3 failed (the status-controls test and both Close tests); restored, green.
- The 44px defect was red in e2e (34.8px) and green after `min-h-11`.

## Gate

- `npm run typecheck`, `npm run lint` and `npm run check`: clean.
- `npm test` (no database): 622 files passed, 85 skipped; 9,512 tests passed, 2,597 skipped (Batch 3 and QA: 9,505, plus 7 new). The careers directory: 128/128.
- `e2e/careers.spec.ts` and `hydration/careers-posting-form.spec.ts`, dev server :3580 (own server, started with `npm run dev -- -p 3580`, stopped by PID): 24/24 (the earlier 23 plus the new test).
- Prod lane :3581 (`prod-build`, own build): `hydration/careers-posting-form.spec.ts` 3/3.
- Not run, per QA's scoped re-run: the DB suites, `custom-hosts`, and the rest of `chromium`.

Note: `playwright.config.ts` starts `npm run dev` on port 3000 when it finds no server on `E2E_BASE_URL`, and times out after 120s. Start the :3580 server by hand first.

## Commits

`73af2b6` (patches), then the fixes commit and a final commit for the 44px dialog buttons and the e2e test.

**Next:** qa (Phase 5, run 2, scoped).
